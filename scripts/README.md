# Migration Scripts

This directory contains migration and maintenance scripts for the O3C platform.

## Table of Contents

1. [Clerk to MongoDB Migration](#clerk-to-mongodb-migration)
2. [Merge All Duplicate Accounts (Bulk)](#merge-all-duplicate-accounts-bulk)
3. [Merge Single Account by Email](#merge-single-account-by-email)

## Clerk to MongoDB Migration

### Overview

The `migrate-clerk-to-mongodb.ts` script migrates user data from Clerk's metadata system to MongoDB collections. This is useful when transitioning from storing user data in Clerk's metadata to a dedicated database.

### What Gets Migrated

- **User Accounts**: Email, credits balance, preferences
- **Admin Roles**: Admin status from Clerk's `publicMetadata`
- **Transaction History**: All transactions from `privateMetadata.transactions`

### Prerequisites

1. **Environment Variables**: Ensure these are set in your `.env` file:
   ```bash
   CLERK_SECRET_KEY=sk_test_xxx...
   MONGODB_URI=mongodb+srv://...
   ```

2. **Dependencies**: Install dependencies if not already installed:
   ```bash
   npm install
   ```

### Usage

#### Dry Run (Preview Only)

Test the migration without making any changes:

```bash
npm run migrate:clerk -- --dry-run
```

This will:
- Show which users would be migrated
- Display user data that would be created
- Not make any actual database changes

#### Production Migration

Run the actual migration:

```bash
npm run migrate:clerk
```

### Features

- **Idempotent**: Safe to run multiple times - skips already migrated users
- **Progress Logging**: Shows real-time progress as users are processed
- **Error Handling**: Continues processing even if individual users fail
- **Summary Report**: Displays detailed statistics at the end
- **Dry Run Mode**: Preview changes without committing them

### Migration Behavior

1. **Existing Users**: If a user already exists in MongoDB (by `clerkUserId`), they are skipped
2. **New Users**: Creates a new `UserAccount` document with data from Clerk
3. **Transactions**: Each transaction in `privateMetadata.transactions` becomes a `UserTransaction` document
4. **API Keys**: Not migrated (users need to regenerate them)

### Output Example

```
╔════════════════════════════════════════════════════════════╗
║         Clerk to MongoDB Migration Script                 ║
╚════════════════════════════════════════════════════════════╝

📊 Connecting to MongoDB...
✅ MongoDB connected

📥 Fetching users from Clerk API...
✅ Fetched 150 total users from Clerk

🔄 Starting migration...

[1/150]
  ✅ user@example.com - Migrated (23 transactions)
[2/150]
  ⏭️  admin@example.com - Already migrated
...

╔════════════════════════════════════════════════════════════╗
║                    Migration Summary                       ║
╚════════════════════════════════════════════════════════════╝

  Total users processed:      150
  Already migrated (skipped): 45
  Newly migrated:             103
  Failed:                     2
  Transactions migrated:      2,341

✅ Migration completed successfully!
```

### Troubleshooting

**Issue**: `CLERK_SECRET_KEY environment variable is not set`
- **Solution**: Add your Clerk secret key to `.env` file

**Issue**: `MONGODB_URI environment variable is not set`
- **Solution**: Add your MongoDB connection string to `.env` file

**Issue**: Individual user migration fails
- **Solution**: The script continues processing other users. Check the error summary at the end for details

**Issue**: Transaction migration fails
- **Solution**: The script creates the user account but logs transaction errors. Review the logs for specific transaction issues

### Notes

- Run the dry-run mode first to preview changes
- The script fetches ALL users from Clerk (with pagination)
- API keys are NOT migrated - users will need to regenerate them
- Admin roles are preserved from Clerk's `publicMetadata`
- Default credits of $20.00 are applied if no credits are found in Clerk

### Support

For issues or questions, please contact the development team.

---

## Merge All Duplicate Accounts (Bulk)

### Overview

The `merge-all-clerk-accounts.ts` script automatically finds and merges ALL duplicate accounts caused by a Clerk key change. This is the easiest way to fix all affected users at once.

### When to Use This

Use this script when:
- You changed your Clerk secret key and ALL users are affected
- You want to merge all duplicate accounts in one operation
- You're fixing the issue for your entire user base

For single-user merges, see [Merge Single Account by Email](#merge-single-account-by-email).

### What It Does

1. **Finds all duplicate accounts**: Searches for emails with multiple accounts
2. **Auto-detects old vs new**: Uses creation date to determine which is which
3. **Merges each pair**: Transfers credits, transactions, and API keys
4. **Removes duplicates**: Deletes old accounts after successful merge
5. **Handles welcome credits**: Automatically removes duplicate welcome credits

### Prerequisites

```bash
# Ensure these environment variables are set
CLERK_SECRET_KEY=sk_test_xxx...  # Your NEW Clerk key
MONGODB_URI=mongodb+srv://...
```

### Usage

#### Step 1: Dry Run (HIGHLY RECOMMENDED)

Always run a dry-run first to preview what will happen:

```bash
npm run merge:all -- --dry-run
```

This shows you:
- How many duplicate accounts were found
- Which accounts will be merged
- What the final credits will be
- How many transactions will be moved
- **No changes are made**

#### Step 2: Run the Actual Merge

Once you've verified the dry-run looks correct:

```bash
npm run merge:all
```

### Example Output

```
╔════════════════════════════════════════════════════════════╗
║       Merge All Duplicate Clerk Accounts (Bulk)           ║
╚════════════════════════════════════════════════════════════╝

🔍 DRY RUN MODE - No changes will be made

📊 Connecting to MongoDB...
✅ MongoDB connected

🔍 Searching for duplicate accounts...

Found 3 email(s) with duplicate accounts:

[1/3] Processing: user1@example.com
  Found 2 accounts
  Old Account: user_abc123... ($21.00)
  New Account: user_xyz789... ($20.00)
  ✅ [DRY RUN] Would merge successfully
     Final credits: $21.00
     Transactions: 2
     API Keys: 0

[2/3] Processing: user2@example.com
  Found 2 accounts
  Old Account: user_def456... ($45.50)
  New Account: user_uvw012... ($20.00)
  ✅ [DRY RUN] Would merge successfully
     Final credits: $45.50
     Transactions: 15
     API Keys: 2

[3/3] Processing: user3@example.com
  Found 2 accounts
  Old Account: user_ghi789... ($20.00)
  New Account: user_rst345... ($20.00)
  ✅ [DRY RUN] Would merge successfully
     Final credits: $20.00
     Transactions: 1
     API Keys: 0

╔════════════════════════════════════════════════════════════╗
║                    Merge Summary                           ║
╚════════════════════════════════════════════════════════════╝

  Total accounts processed:  3
  Successful merges:         3
  Failed merges:             0
  Credits restored:          $6.50
  Transactions merged:       18
  API keys migrated:         2

🔍 This was a DRY RUN - no changes were made
   Run without --dry-run to perform the actual merges
```

### Safety Features

✅ **Automatic Detection**: Finds duplicates by email address  
✅ **Smart Sorting**: Uses creation date to identify old vs new accounts  
✅ **Dry Run Mode**: Test before making changes  
✅ **Safety Limit**: Skips emails with 3+ accounts (manual merge required)  
✅ **Error Handling**: Continues processing even if individual merges fail  
✅ **Detailed Logging**: See exactly what's happening for each account  

### Special Cases

**More than 2 accounts per email:**
If an email has 3 or more accounts, the script will skip it for safety and tell you to merge manually:

```bash
npm run merge:accounts -- --email=problematic@example.com
```

**No duplicates found:**
If the script finds no duplicates, you'll see:
```
✅ No duplicate accounts found!
```

### After Running

Once the merge completes:
1. All users should **log out and log back in** to refresh their session
2. Credits will show the correct combined amount
3. Transaction history will include all past purchases
4. Old accounts are deleted from MongoDB
5. API keys (if any) are migrated to new accounts

### Troubleshooting

**Issue**: Script shows no duplicates but users report missing credits
- **Solution**: Users may need to log in with the new Clerk key first to create the new account

**Issue**: Some merges fail
- **Solution**: Check the error summary at the end - the script continues with other accounts

**Issue**: User has more than 2 accounts
- **Solution**: Use the single-account merge script for that specific email

---

## Merge Single Account by Email

### Overview

The `merge-clerk-accounts.ts` script merges user data when you change Clerk secret keys. When you change your Clerk key, new user IDs are generated, causing the system to create duplicate accounts in MongoDB. This script merges your old account data into your new account.

### Problem This Solves

When you change your Clerk secret key:
1. Clerk assigns new user IDs to all users
2. MongoDB has your old account with existing credits and transactions
3. When you log in with the new key, a NEW account is created with $20 welcome credits
4. You now have 2 accounts in MongoDB, but only see the new one (missing your purchase history)

This script:
- Merges all transactions from old account to new account
- Transfers credits (removing duplicate welcome credits)
- Moves API keys to new account
- Deletes the old account

### Prerequisites

1. **Environment Variables**: Ensure these are set in your `.env` file:
   ```bash
   CLERK_SECRET_KEY=sk_test_xxx...  # Your NEW Clerk key
   MONGODB_URI=mongodb+srv://...
   ```

2. **Both accounts must exist**: 
   - Log in with the new Clerk key first (to create the new account)
   - Old account should still exist in MongoDB

### Usage

#### Method 1: Merge by Email (Recommended)

The easiest way is to search by your email address. The script will automatically detect which account is old and which is new based on creation date.

**Dry Run (Preview Only):**
```bash
npm run merge:accounts -- --email=your@email.com --dry-run
```

**Actual Merge:**
```bash
npm run merge:accounts -- --email=your@email.com
```

#### Method 2: Merge by Clerk User IDs

If you know both Clerk user IDs, you can specify them directly:

**Dry Run:**
```bash
npm run merge:accounts -- --old-id=user_abc123 --new-id=user_xyz789 --dry-run
```

**Actual Merge:**
```bash
npm run merge:accounts -- --old-id=user_abc123 --new-id=user_xyz789
```

### What Gets Merged

✅ **Credits**: Combined from both accounts (minus duplicate welcome credits)  
✅ **Transactions**: All transaction history from old account  
✅ **API Keys**: Moved to new account  
✅ **Purchase History**: Preserved from old account  

❌ **Welcome Credits Duplication**: Automatically detected and removed

### Example Output

```
╔════════════════════════════════════════════════════════════╗
║         Merge Clerk Accounts After Key Change             ║
╚════════════════════════════════════════════════════════════╝

🔍 DRY RUN MODE - No changes will be made

📊 Connecting to MongoDB...
✅ MongoDB connected

🔍 Searching for accounts with email: user@example.com

✅ Found 2 accounts:
  Old Account (created 11/1/2025):
    Clerk ID: user_abc123
    Credits: $21.00
  New Account (created 11/9/2025):
    Clerk ID: user_xyz789
    Credits: $20.00

📊 Starting account merge...
  Old Clerk User ID: user_abc123
  New Clerk User ID: user_xyz789
  Dry Run: YES

✅ Found both accounts:
  Old Account: user@example.com ($21.00)
  New Account: user@example.com ($20.00)

📜 Found 2 transactions in old account

⚠️  Both accounts have welcome credits detected
  Old welcome: $20.00
  New welcome: $20.00
  → Will remove duplicate $20.00 welcome credits

💰 Credit calculation:
  Old account: $21.00
  New account: $20.00
  Credits to transfer: $1.00
  Final total: $21.00

🔑 Found 0 API keys in old account

🔍 DRY RUN - No changes made

╔════════════════════════════════════════════════════════════╗
║                    Merge Summary                           ║
╚════════════════════════════════════════════════════════════╝

  Old account credits:    $21.00
  New account credits:    $20.00
  Transactions merged:    2
  API keys merged:        0
  Final credits:          $21.00

🔍 This was a DRY RUN - no changes were made
   Run without --dry-run to perform the actual merge
```

### Step-by-Step Guide

1. **Backup your MongoDB data** (optional but recommended)

2. **Run a dry-run first** to preview the changes:
   ```bash
   npm run merge:accounts -- --email=your@email.com --dry-run
   ```

3. **Review the output** to ensure:
   - Both accounts were found
   - Credit calculation looks correct
   - Transaction count is accurate

4. **Run the actual merge**:
   ```bash
   npm run merge:accounts -- --email=your@email.com
   ```

5. **Verify in your app**:
   - Log out and log back in
   - Check that your credits show the correct amount ($21 in the example)
   - Verify transaction history includes your purchase

### Troubleshooting

**Issue**: "Only one account found with email"
- **Solution**: You need to log in with the new Clerk key first to create the new account

**Issue**: "No accounts found with email"
- **Solution**: Check that the email matches your Clerk account exactly

**Issue**: "Found 3+ accounts with email"
- **Solution**: Use the `--old-id` and `--new-id` method to specify which accounts to merge

**Issue**: Credits don't look right after merge
- **Solution**: Check the output for duplicate welcome credits detection - the script should automatically handle this

### Safety Features

- ✅ **Dry Run Mode**: Test before making changes
- ✅ **Automatic Duplicate Detection**: Removes duplicate welcome credits
- ✅ **Detailed Logging**: See exactly what will happen
- ✅ **Error Handling**: Clear error messages if something goes wrong

### After Merging

Once the merge is complete:
1. Log out and log back in to refresh your session
2. Your credits should show the correct combined amount
3. Your transaction history should include all past purchases
4. Old account is deleted from MongoDB
5. All API keys (if any) are now associated with the new account

### Notes

- The script is **not** idempotent - don't run it twice on the same accounts
- Always run a **dry-run first** to preview changes
- The old account is **permanently deleted** after merge
- Duplicate welcome credits are **automatically detected and removed**

### Support

For issues or questions, please contact the development team.

