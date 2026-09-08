// Re-export everything from the new user account service
export {
  getUserCredits,
  addCredits,
  deductCredits,
  getTransactionHistory,
  addTransaction,
  generateAPIKey,
  getUserAPIKeys,
  validateAPIKey,
  deactivateAPIKey,
  giveWelcomeCredits,
  chargeForUsage,
  chargeCredits,
  ensureLitellmKey,
  getLitellmVirtualKey,
  type APIKey,
  type Transaction,
} from './user-account-service';

// Re-export credit packages from credits-client
export { CREDIT_PACKAGES } from './credits-client';
export type { Transaction as CreditsClientTransaction, APIKey as CreditsClientAPIKey } from './credits-client';