/**
 * IntentGuard Stripe Billing Module
 *
 * Handles subscription lifecycle:
 *   - Checkout session creation
 *   - Webhook processing (payment success, failure, cancellation)
 *   - API key provisioning and suspension
 *
 * Stripe Products (create in Stripe Dashboard):
 *   - Pro:        $49/mo or $470/yr
 *   - Enterprise: $299/mo or $2990/yr
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY     - Stripe secret key (sk_...)
 *   STRIPE_WEBHOOK_SECRET - Webhook signing secret (whsec_...)
 *   STRIPE_PRO_MONTHLY    - Price ID for Pro monthly
 *   STRIPE_PRO_YEARLY     - Price ID for Pro yearly
 *   STRIPE_ENT_MONTHLY    - Price ID for Enterprise monthly
 *   STRIPE_ENT_YEARLY     - Price ID for Enterprise yearly
 */

import Stripe from 'stripe';
import crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────

export interface Subscriber {
  apiKey: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  email: string;
  tier: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'past_due' | 'canceled' | 'suspended';
  createdAt: string;
  requestCount: number;
  lastUsed: string | null;
}

export interface BillingConfig {
  stripeSecretKey: string;
  webhookSecret: string;
  priceIds: {
    proMonthly: string;
    proYearly: string;
    enterpriseMonthly: string;
    enterpriseYearly: string;
  };
  baseUrl: string; // e.g. https://intentshield.xyz
}

// ─── Storage (in-memory, swap with DB in production) ─────────

const subscribers = new Map<string, Subscriber>(); // apiKey -> Subscriber
const customerToKey = new Map<string, string>();    // stripeCustomerId -> apiKey
const emailToKey = new Map<string, string>();        // email -> apiKey

export function getSubscribers() { return subscribers; }
export function getSubscriberByKey(apiKey: string) { return subscribers.get(apiKey); }
export function getSubscriberByEmail(email: string) {
  const key = emailToKey.get(email);
  return key ? subscribers.get(key) : undefined;
}

// ─── Stripe Client ──────────────────────────────────────────

let stripe: Stripe;
let config: BillingConfig;

export function initBilling(cfg: BillingConfig) {
  config = cfg;
  stripe = new Stripe(cfg.stripeSecretKey, { apiVersion: '2025-04-30.basil' as Stripe.LatestApiVersion });
}

// ─── Checkout Session ───────────────────────────────────────

export async function createCheckoutSession(params: {
  email?: string;
  tier: 'pro' | 'enterprise';
  interval: 'monthly' | 'yearly';
}): Promise<{ url: string; sessionId: string }> {
  const { tier, interval, email } = params;

  const priceId = tier === 'pro'
    ? (interval === 'yearly' ? config.priceIds.proYearly : config.priceIds.proMonthly)
    : (interval === 'yearly' ? config.priceIds.enterpriseYearly : config.priceIds.enterpriseMonthly);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${config.baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.baseUrl}/pricing`,
    metadata: { tier, interval },
  };

  if (email) {
    sessionParams.customer_email = email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return {
    url: session.url!,
    sessionId: session.id,
  };
}

// ─── Customer Portal ────────────────────────────────────────

export async function createPortalSession(apiKey: string): Promise<string> {
  const sub = subscribers.get(apiKey);
  if (!sub) throw new Error('Subscriber not found');

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${config.baseUrl}/dashboard`,
  });

  return session.url;
}

// ─── Webhook Processing ─────────────────────────────────────

export async function handleWebhook(
  body: string | Buffer,
  signature: string,
): Promise<{ event: string; action: string }> {
  const event = stripe.webhooks.constructEvent(body, signature, config.webhookSecret);

  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);

    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(event.data.object as Stripe.Subscription);

    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event.data.object as Stripe.Subscription);

    case 'invoice.payment_failed':
      return handlePaymentFailed(event.data.object as Stripe.Invoice);

    case 'invoice.paid':
      return handleInvoicePaid(event.data.object as Stripe.Invoice);

    default:
      return { event: event.type, action: 'ignored' };
  }
}

// ─── Webhook Handlers ───────────────────────────────────────

async function handleCheckoutComplete(
  session: Stripe.Checkout.Session,
): Promise<{ event: string; action: string }> {
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  const email = session.customer_details?.email || session.customer_email || '';
  const tier = (session.metadata?.tier || 'pro') as 'pro' | 'enterprise';

  // Check if customer already has a key
  const existingKey = customerToKey.get(customerId) || emailToKey.get(email);
  if (existingKey) {
    const sub = subscribers.get(existingKey)!;
    sub.tier = tier;
    sub.status = 'active';
    sub.stripeSubscriptionId = subscriptionId;
    return { event: 'checkout.session.completed', action: `upgraded_to_${tier}` };
  }

  // Create new API key
  const apiKey = generateApiKey();
  const subscriber: Subscriber = {
    apiKey,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    email,
    tier,
    status: 'active',
    createdAt: new Date().toISOString(),
    requestCount: 0,
    lastUsed: null,
  };

  subscribers.set(apiKey, subscriber);
  customerToKey.set(customerId, apiKey);
  if (email) emailToKey.set(email, apiKey);

  console.log(`[billing] New ${tier} subscriber: ${email} -> ${apiKey.slice(0, 8)}...`);

  return { event: 'checkout.session.completed', action: `created_${tier}_key` };
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
): Promise<{ event: string; action: string }> {
  const customerId = subscription.customer as string;
  const apiKey = customerToKey.get(customerId);
  if (!apiKey) return { event: 'customer.subscription.updated', action: 'no_matching_key' };

  const sub = subscribers.get(apiKey)!;

  if (subscription.status === 'active') {
    sub.status = 'active';
  } else if (subscription.status === 'past_due') {
    sub.status = 'past_due';
  } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
    sub.status = 'suspended';
    sub.tier = 'free';
  }

  return { event: 'customer.subscription.updated', action: `status_${sub.status}` };
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<{ event: string; action: string }> {
  const customerId = subscription.customer as string;
  const apiKey = customerToKey.get(customerId);
  if (!apiKey) return { event: 'customer.subscription.deleted', action: 'no_matching_key' };

  const sub = subscribers.get(apiKey)!;
  sub.status = 'canceled';
  sub.tier = 'free';

  console.log(`[billing] Subscription canceled: ${sub.email}`);

  return { event: 'customer.subscription.deleted', action: 'downgraded_to_free' };
}

async function handlePaymentFailed(
  invoice: Stripe.Invoice,
): Promise<{ event: string; action: string }> {
  const customerId = invoice.customer as string;
  const apiKey = customerToKey.get(customerId);
  if (!apiKey) return { event: 'invoice.payment_failed', action: 'no_matching_key' };

  const sub = subscribers.get(apiKey)!;
  sub.status = 'past_due';

  // Grace period: keep tier active for 7 days, then suspend
  setTimeout(() => {
    if (sub.status === 'past_due') {
      sub.status = 'suspended';
      sub.tier = 'free';
      console.log(`[billing] Grace period expired, suspended: ${sub.email}`);
    }
  }, 7 * 24 * 60 * 60 * 1000);

  console.log(`[billing] Payment failed (7-day grace): ${sub.email}`);

  return { event: 'invoice.payment_failed', action: 'grace_period_started' };
}

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
): Promise<{ event: string; action: string }> {
  const customerId = invoice.customer as string;
  const apiKey = customerToKey.get(customerId);
  if (!apiKey) return { event: 'invoice.paid', action: 'no_matching_key' };

  const sub = subscribers.get(apiKey)!;
  if (sub.status === 'past_due' || sub.status === 'suspended') {
    sub.status = 'active';
    // Restore tier based on subscription
    try {
      const subscription = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      const priceId = subscription.items.data[0]?.price?.id;
      if (priceId === config.priceIds.enterpriseMonthly || priceId === config.priceIds.enterpriseYearly) {
        sub.tier = 'enterprise';
      } else {
        sub.tier = 'pro';
      }
    } catch {
      sub.tier = 'pro';
    }
    console.log(`[billing] Payment recovered, reactivated: ${sub.email}`);
  }

  return { event: 'invoice.paid', action: 'payment_recovered' };
}

// ─── API Key Retrieval (post-checkout) ──────────────────────

export async function getApiKeyFromSession(sessionId: string): Promise<{
  apiKey: string;
  tier: string;
  email: string;
} | null> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customerId = session.customer as string;
    const apiKey = customerToKey.get(customerId);
    if (!apiKey) return null;

    const sub = subscribers.get(apiKey)!;
    return { apiKey, tier: sub.tier, email: sub.email };
  } catch {
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────

function generateApiKey(): string {
  return 'ig_' + crypto.randomBytes(24).toString('hex');
}

export function isSubscriptionActive(apiKey: string): boolean {
  const sub = subscribers.get(apiKey);
  if (!sub) return false;
  return sub.status === 'active' || sub.status === 'past_due';
}
