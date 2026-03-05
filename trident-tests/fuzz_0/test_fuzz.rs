use fuzz_accounts::*;
use trident_fuzz::fuzzing::*;
mod fuzz_accounts;
mod types;
use types::*;
use types::intent_guard::*;

use rand::Rng;

const PROGRAM_ID: Pubkey = pubkey!("4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7");

fn find_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config"], &PROGRAM_ID)
}

fn find_intent_pda(user: &Pubkey, app_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"intent", user.as_ref(), app_id.as_ref()], &PROGRAM_ID)
}

fn random_hash() -> [u8; 32] {
    rand::thread_rng().gen()
}

#[derive(FuzzTestMethods)]
struct FuzzTest {
    trident: Trident,
    fuzz_accounts: AccountAddresses,
}

#[flow_executor]
impl FuzzTest {
    fn new() -> Self {
        Self {
            trident: Trident::default(),
            fuzz_accounts: AccountAddresses::default(),
        }
    }

    #[init]
    fn start(&mut self) {
        let admin_kp = self.trident.payer();
        let admin = admin_kp.pubkey();
        let (config_pda, _) = find_config_pda();

        self.fuzz_accounts.config.insert_with_address(config_pda);
        self.fuzz_accounts.admin.insert_with_address(admin);

        let ix = InitializeInstruction::data(InitializeInstructionData::new())
            .accounts(InitializeInstructionAccounts::new(config_pda, admin))
            .instruction();

        let result = self.trident.process_transaction(&[ix], Some("initialize"));
        assert!(result.is_success(), "Initialize must succeed: {}", result.logs());
    }

    // ── Flow 1: Normal commit → verify cycle ──
    #[flow]
    fn flow_commit_verify(&mut self) {
        let user_kp = self.trident.payer();
        let user = user_kp.pubkey();
        let app_id = Pubkey::new_unique();
        let intent_hash = random_hash();
        let (intent_pda, _) = find_intent_pda(&user, &app_id);
        let (config_pda, _) = find_config_pda();

        // Commit
        let commit_ix = CommitIntentInstruction::data(CommitIntentInstructionData::new(
            app_id, intent_hash, 300,
        ))
        .accounts(CommitIntentInstructionAccounts::new(intent_pda, config_pda, user))
        .instruction();

        let result = self.trident.process_transaction(&[commit_ix], Some("commit"));
        if result.is_error() {
            return; // PDA might already exist
        }

        // Verify with correct hash — should succeed
        let verify_ix = VerifyIntentInstruction::data(VerifyIntentInstructionData::new(intent_hash))
            .accounts(VerifyIntentInstructionAccounts::new(intent_pda, config_pda, user))
            .instruction();

        let result = self.trident.process_transaction(&[verify_ix], Some("verify"));
        assert!(result.is_success(), "INVARIANT: verify with correct hash must succeed: {}", result.logs());
    }

    // ── Flow 2: Wrong hash always rejected ──
    #[flow]
    fn flow_wrong_hash_rejected(&mut self) {
        let user_kp = self.trident.payer();
        let user = user_kp.pubkey();
        let app_id = Pubkey::new_unique();
        let intent_hash = random_hash();
        let wrong_hash = random_hash();
        let (intent_pda, _) = find_intent_pda(&user, &app_id);
        let (config_pda, _) = find_config_pda();

        let commit_ix = CommitIntentInstruction::data(CommitIntentInstructionData::new(
            app_id, intent_hash, 300,
        ))
        .accounts(CommitIntentInstructionAccounts::new(intent_pda, config_pda, user))
        .instruction();

        if self.trident.process_transaction(&[commit_ix], Some("commit")).is_error() {
            return;
        }

        // Wrong hash — must fail
        let verify_ix = VerifyIntentInstruction::data(VerifyIntentInstructionData::new(wrong_hash))
            .accounts(VerifyIntentInstructionAccounts::new(intent_pda, config_pda, user))
            .instruction();

        let result = self.trident.process_transaction(&[verify_ix], Some("verify-wrong"));
        assert!(result.is_error(), "INVARIANT VIOLATED: wrong hash accepted!");

        // Cleanup
        let revoke_ix = RevokeIntentInstruction::data(RevokeIntentInstructionData::new(app_id))
            .accounts(RevokeIntentInstructionAccounts::new(intent_pda, user))
            .instruction();
        let _ = self.trident.process_transaction(&[revoke_ix], Some("revoke-cleanup"));
    }

    // ── Flow 3: Pause enforcement ──
    #[flow]
    fn flow_pause_enforcement(&mut self) {
        let admin_kp = self.trident.payer();
        let admin = admin_kp.pubkey();
        let (config_pda, _) = find_config_pda();

        // Pause
        let pause_ix = PauseProtocolInstruction::data(PauseProtocolInstructionData::new())
            .accounts(PauseProtocolInstructionAccounts::new(config_pda, admin))
            .instruction();

        if self.trident.process_transaction(&[pause_ix], Some("pause")).is_error() {
            return;
        }

        // Commit should fail
        let app_id = Pubkey::new_unique();
        let (intent_pda, _) = find_intent_pda(&admin, &app_id);

        let commit_ix = CommitIntentInstruction::data(CommitIntentInstructionData::new(
            app_id, random_hash(), 300,
        ))
        .accounts(CommitIntentInstructionAccounts::new(intent_pda, config_pda, admin))
        .instruction();

        let result = self.trident.process_transaction(&[commit_ix], Some("commit-paused"));
        assert!(result.is_error(), "INVARIANT VIOLATED: commit succeeded while paused!");

        // Unpause
        let unpause_ix = UnpauseProtocolInstruction::data(UnpauseProtocolInstructionData::new())
            .accounts(UnpauseProtocolInstructionAccounts::new(config_pda, admin))
            .instruction();
        let _ = self.trident.process_transaction(&[unpause_ix], Some("unpause"));
    }

    // ── Flow 4: TTL validation ──
    #[flow]
    fn flow_ttl_validation(&mut self) {
        let user_kp = self.trident.payer();
        let user = user_kp.pubkey();
        let app_id = Pubkey::new_unique();
        let (intent_pda, _) = find_intent_pda(&user, &app_id);
        let (config_pda, _) = find_config_pda();

        // Random TTL — some will be valid, some won't
        let ttl: i64 = rand::thread_rng().gen_range(-100..=10_000);

        let commit_ix = CommitIntentInstruction::data(CommitIntentInstructionData::new(
            app_id, random_hash(), ttl,
        ))
        .accounts(CommitIntentInstructionAccounts::new(intent_pda, config_pda, user))
        .instruction();

        let result = self.trident.process_transaction(&[commit_ix], Some("commit-ttl"));

        if ttl > 3600 || (ttl != 0 && ttl < 5) {
            // dev-testing MIN_TTL=5, MAX_TTL=3600
            assert!(result.is_error(), "INVARIANT VIOLATED: invalid TTL {} accepted", ttl);
        }

        // Cleanup if it succeeded
        if result.is_success() {
            let revoke_ix = RevokeIntentInstruction::data(RevokeIntentInstructionData::new(app_id))
                .accounts(RevokeIntentInstructionAccounts::new(intent_pda, user))
                .instruction();
            let _ = self.trident.process_transaction(&[revoke_ix], Some("revoke-ttl"));
        }
    }

    // ── Flow 5: Duplicate commit rejected ──
    #[flow]
    fn flow_duplicate_commit(&mut self) {
        let user_kp = self.trident.payer();
        let user = user_kp.pubkey();
        let app_id = Pubkey::new_unique();
        let hash = random_hash();
        let (intent_pda, _) = find_intent_pda(&user, &app_id);
        let (config_pda, _) = find_config_pda();

        let commit_ix = CommitIntentInstruction::data(CommitIntentInstructionData::new(
            app_id, hash, 300,
        ))
        .accounts(CommitIntentInstructionAccounts::new(intent_pda, config_pda, user))
        .instruction();

        if self.trident.process_transaction(&[commit_ix.clone()], Some("commit-1")).is_error() {
            return;
        }

        // Second commit — must fail
        let result = self.trident.process_transaction(&[commit_ix], Some("commit-dup"));
        assert!(result.is_error(), "INVARIANT VIOLATED: duplicate commit accepted!");

        // Cleanup
        let revoke_ix = RevokeIntentInstruction::data(RevokeIntentInstructionData::new(app_id))
            .accounts(RevokeIntentInstructionAccounts::new(intent_pda, user))
            .instruction();
        let _ = self.trident.process_transaction(&[revoke_ix], Some("revoke-dup"));
    }

    // ── Flow 6: Commit → revoke → re-commit ──
    #[flow]
    fn flow_revoke_reuse(&mut self) {
        let user_kp = self.trident.payer();
        let user = user_kp.pubkey();
        let app_id = Pubkey::new_unique();
        let (intent_pda, _) = find_intent_pda(&user, &app_id);
        let (config_pda, _) = find_config_pda();

        // Commit
        let commit_ix = CommitIntentInstruction::data(CommitIntentInstructionData::new(
            app_id, random_hash(), 300,
        ))
        .accounts(CommitIntentInstructionAccounts::new(intent_pda, config_pda, user))
        .instruction();

        if self.trident.process_transaction(&[commit_ix], Some("commit-rev")).is_error() {
            return;
        }

        // Revoke
        let revoke_ix = RevokeIntentInstruction::data(RevokeIntentInstructionData::new(app_id))
            .accounts(RevokeIntentInstructionAccounts::new(intent_pda, user))
            .instruction();

        let result = self.trident.process_transaction(&[revoke_ix], Some("revoke"));
        assert!(result.is_success(), "Revoke must succeed: {}", result.logs());

        // Re-commit
        let commit_ix2 = CommitIntentInstruction::data(CommitIntentInstructionData::new(
            app_id, random_hash(), 300,
        ))
        .accounts(CommitIntentInstructionAccounts::new(intent_pda, config_pda, user))
        .instruction();

        let result = self.trident.process_transaction(&[commit_ix2], Some("re-commit"));
        assert!(result.is_success(), "Re-commit after revoke must succeed: {}", result.logs());

        // Cleanup
        let revoke_ix2 = RevokeIntentInstruction::data(RevokeIntentInstructionData::new(app_id))
            .accounts(RevokeIntentInstructionAccounts::new(intent_pda, user))
            .instruction();
        let _ = self.trident.process_transaction(&[revoke_ix2], Some("cleanup"));
    }

    // ── Flow 7: Expired intent verification ──
    #[flow]
    fn flow_expired_intent(&mut self) {
        let user_kp = self.trident.payer();
        let user = user_kp.pubkey();
        let app_id = Pubkey::new_unique();
        let intent_hash = random_hash();
        let (intent_pda, _) = find_intent_pda(&user, &app_id);
        let (config_pda, _) = find_config_pda();

        // Commit with minimum TTL
        let commit_ix = CommitIntentInstruction::data(CommitIntentInstructionData::new(
            app_id, intent_hash, 5, // dev-testing MIN_TTL
        ))
        .accounts(CommitIntentInstructionAccounts::new(intent_pda, config_pda, user))
        .instruction();

        if self.trident.process_transaction(&[commit_ix], Some("commit-exp")).is_error() {
            return;
        }

        // Warp forward 10 seconds past expiry
        self.trident.forward_in_time(15);

        // Verify — must fail (expired)
        let verify_ix = VerifyIntentInstruction::data(VerifyIntentInstructionData::new(intent_hash))
            .accounts(VerifyIntentInstructionAccounts::new(intent_pda, config_pda, user))
            .instruction();

        let result = self.trident.process_transaction(&[verify_ix], Some("verify-expired"));
        assert!(result.is_error(), "INVARIANT VIOLATED: expired intent verified!");

        // Cleanup
        let revoke_ix = RevokeIntentInstruction::data(RevokeIntentInstructionData::new(app_id))
            .accounts(RevokeIntentInstructionAccounts::new(intent_pda, user))
            .instruction();
        let _ = self.trident.process_transaction(&[revoke_ix], Some("revoke-exp"));
    }

    // ── Flow 8: Counter monotonicity check ──
    #[flow]
    fn flow_counter_monotonicity(&mut self) {
        let user_kp = self.trident.payer();
        let user = user_kp.pubkey();
        let (config_pda, _) = find_config_pda();

        // Read counters before
        let config_before: GuardConfig = self.trident.get_account_with_type(&config_pda, 8).unwrap();
        let commits_before = config_before.total_commits;
        let verifies_before = config_before.total_verifies;

        // Do a commit + verify cycle
        let app_id = Pubkey::new_unique();
        let hash = random_hash();
        let (intent_pda, _) = find_intent_pda(&user, &app_id);

        let commit_ix = CommitIntentInstruction::data(CommitIntentInstructionData::new(
            app_id, hash, 300,
        ))
        .accounts(CommitIntentInstructionAccounts::new(intent_pda, config_pda, user))
        .instruction();

        if self.trident.process_transaction(&[commit_ix], Some("commit-cnt")).is_error() {
            return;
        }

        let verify_ix = VerifyIntentInstruction::data(VerifyIntentInstructionData::new(hash))
            .accounts(VerifyIntentInstructionAccounts::new(intent_pda, config_pda, user))
            .instruction();

        if self.trident.process_transaction(&[verify_ix], Some("verify-cnt")).is_error() {
            return;
        }

        // Read counters after
        let config_after: GuardConfig = self.trident.get_account_with_type(&config_pda, 8).unwrap();

        assert!(
            config_after.total_commits > commits_before,
            "INVARIANT VIOLATED: total_commits did not increase"
        );
        assert!(
            config_after.total_verifies > verifies_before,
            "INVARIANT VIOLATED: total_verifies did not increase"
        );
    }

    #[end]
    fn end(&mut self) {}
}

fn main() {
    // 5000 iterations, 100 instructions per iteration
    FuzzTest::fuzz(5000, 100);
}
