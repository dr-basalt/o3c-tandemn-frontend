import Stripe from 'stripe';
import { STRIPE_CREDIT_PACKAGES } from './stripe-config';

// Server-side Stripe instance with build-time safety
export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_for_build', 
  {
    apiVersion: '2025-08-27.basil',
    typescript: true,
  }
);

// Client-side publishable key
export const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!;

// Re-export credit packages
export { STRIPE_CREDIT_PACKAGES };

// Create Stripe Checkout Session
export async function createCheckoutSession({
  packageId,
  userId,
  userEmail,
  customAmount,
  customPackage,
}: {
  packageId: string;
  userId: string;
  userEmail: string;
  customAmount?: number;
  customPackage?: {
    id: string;
    name: string;
    credits: number;
    price: number;
    currency: string;
    description: string;
  };
}) {
  // Runtime check for Stripe key
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  // Runtime check for domain
  const domain = process.env.NEXT_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error('NEXT_PUBLIC_DOMAIN environment variable is not set. Required for redirect URLs.');
  }

  // Use custom package if provided, otherwise find from predefined packages
  const creditPackage = customPackage || STRIPE_CREDIT_PACKAGES.find(pkg => pkg.id === packageId);
  
  if (!creditPackage) {
    throw new Error(`Invalid credit package: ${packageId}`);
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: creditPackage.currency,
          product_data: {
            name: creditPackage.name,
            description: creditPackage.description,
            images: [`${domain}/o3c-logo-circle.svg`],
          },
          unit_amount: creditPackage.price,
        },
        quantity: 1,
      },
    ],
    mode: 'payment', // One-time payment (not subscription)
    success_url: `${domain}/credits?session_id={CHECKOUT_SESSION_ID}&success=true`,
    cancel_url: `${domain}/credits?canceled=true`,
    customer_email: userEmail,
    metadata: {
      userId,
      packageId,
      creditsAmount: creditPackage.credits.toString(),
      type: 'credit_purchase',
    },
  });

  return session;
}

// Verify Stripe webhook signature
export function verifyStripeSignature(body: string, signature: string): Stripe.Event {
  // Runtime check for webhook secret
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('Stripe webhook secret is not configured. Please set STRIPE_WEBHOOK_SECRET environment variable.');
  }

  try {
    return stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    throw new Error(`Webhook signature verification failed: ${error}`);
  }
}