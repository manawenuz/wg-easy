# Traffic Groups & Sub-accounts - Testing Guide

## Implementation Summary

This implementation adds two major features to the WireGuard management application:

### 1. Traffic/Speed Groups
- **Database**: New `traffic_groups` table with 12 auto-generated colors
- **API**: Full CRUD endpoints at `/api/admin/traffic-groups`
- **Enforcement**: Quota and speed limit services now check group settings first
- **UI**: Admin page for managing groups, badges on client cards, group selector in client creation

### 2. Sub-accounts
- **Database**: Added `parent_user_id` column to users table
- **API**: Endpoint to create sub-accounts at `/api/admin/users/[id]/sub-accounts`
- **Restrictions**: Sub-accounts cannot create clients (enforced in API)
- **UI**: Hierarchical display in user list, sub-account management in user detail page

---

## Testing Instructions

### Prerequisites

1. Start the development environment:
   ```bash
   npm run dev
   ```

2. The migration will run automatically on startup, creating:
   - `traffic_groups` table with default "Unlimited" group
   - New columns: `users_table.parent_user_id`, `users_table.default_traffic_group_id`, `clients_table.traffic_group_id`

---

## Test Suite

### A. Traffic Groups - Basic Operations

#### Test 1: Create Traffic Group
1. Navigate to **Admin → Traffic Groups**
2. Click "Create Group"
3. Enter:
   - Name: "Premium"
   - Upload: 10000 Kbps
   - Download: 10000 Kbps
   - Quota: 50 GB
   - Period: Monthly
   - Auto-disable: Enabled
4. Save and verify:
   - ✓ Group appears in list with auto-generated color
   - ✓ Shows "50 GB / monthly" in quota column
   - ✓ Shows "↑ 10000 Kbps / ↓ 10000 Kbps" in speed column

#### Test 2: Set Default Group
1. Click "Set as Default" on the "Premium" group
2. Verify:
   - ✓ "(Default)" badge appears next to Premium
   - ✓ Previous default group no longer shows default badge

#### Test 3: Create Client with Group
1. Navigate to main clients page
2. Click "New Client"
3. Verify:
   - ✓ Traffic Group dropdown is pre-selected to "Premium (Default)"
4. Create client named "Test Client 1"
5. Verify:
   - ✓ Client card shows colored badge with "Premium"
   - ✓ Badge color matches the group color

#### Test 4: Edit Traffic Group
1. Go back to Admin → Traffic Groups
2. Click "Edit" on Premium group
3. Change quota to 100 GB
4. Save and verify:
   - ✓ Group shows "100 GB / monthly"
   - ✓ Existing clients inherit the new quota

#### Test 5: Delete Traffic Group
1. Create a new group "Basic" (unlimited speed, no quota)
2. Create a client assigned to "Basic"
3. Try to delete "Basic" group
4. Verify:
   - ✓ Group is deleted successfully
   - ✓ Client is automatically reassigned to default group
   - ✓ Client card now shows default group badge

---

### B. Traffic Groups - Color Cycling

#### Test 6: Create 13+ Groups
1. Create 13 traffic groups with different names
2. Verify:
   - ✓ First 12 groups get unique colors
   - ✓ 13th group reuses the first color (cycling)
   - ✓ All groups display correctly in the list

---

### C. Traffic Groups - Dark/Light Mode

#### Test 7: Theme Switching
1. Toggle between dark and light mode (if theme switcher exists)
2. Verify:
   - ✓ Group badges adapt colors appropriately
   - ✓ Client card badges remain visible and readable
   - ✓ Admin table remains readable

---

### D. Sub-accounts - Basic Operations

#### Test 8: Create Sub-account
1. Navigate to **Admin → Users**
2. Find a CLIENT-role user (or create one)
3. Click "Add Sub-account" next to the user
4. Enter:
   - Name: "Sub User 1"
   - Email: "sub1@example.com"
5. Save and verify:
   - ✓ Sub-account appears indented under parent with "↳" symbol
   - ✓ Sub-account has CLIENT role
   - ✓ Background color differentiates sub-accounts

#### Test 9: View Sub-account Details
1. Click "Edit" on the sub-account
2. Verify:
   - ✓ Shows "Parent User" field with link to parent
   - ✓ Cannot add sub-accounts to this user (no "Add Sub-account" button)
   - ✓ Can edit email, enable/disable

#### Test 10: Sub-account Cannot Create Clients
1. Try to create a client via API as a sub-account:
   ```bash
   curl -X POST http://localhost:51821/api/client \
     -H "Content-Type: application/json" \
     -d '{"name": "Test", "userId": <sub-account-id>}'
   ```
2. Verify:
   - ✓ Returns 403 error
   - ✓ Error message: "Sub-accounts cannot create clients. Please use the parent account."

#### Test 11: Parent Creates Client for Sub-account
1. As admin, create a client
2. In the client creation form, select the sub-account's user (if owner picker is implemented)
3. Verify:
   - ✓ Client is created successfully
   - ✓ Client is owned by sub-account
   - ✓ Client inherits parent's default traffic group

---

### E. Sub-accounts - Hierarchy

#### Test 12: Prevent Deep Nesting
1. Try to add a sub-account to an existing sub-account via API:
   ```bash
   curl -X POST http://localhost:51821/api/admin/users/<sub-account-id>/sub-accounts \
     -H "Content-Type: application/json" \
     -d '{"name": "Sub Sub User"}'
   ```
2. Verify:
   - ✓ Returns 400 error
   - ✓ Error message: "Cannot create sub-account of a sub-account"

#### Test 13: Delete Parent User
1. Create a parent user with 2 sub-accounts
2. Delete the parent user
3. Verify:
   - ✓ Confirmation dialog warns about sub-accounts (if implemented)
   - ✓ Parent and all sub-accounts are deleted (CASCADE)
   - ✓ No orphaned sub-accounts remain

---

### F. Integration Tests

#### Test 14: Traffic Groups + Sub-accounts
1. Create parent user "Family Admin"
2. Set parent's default traffic group to "Premium"
3. Create sub-account "Family Member 1"
4. Create client for "Family Member 1"
5. Verify:
   - ✓ Client automatically gets "Premium" group
   - ✓ Client shows Premium badge
   - ✓ Speed limits and quotas from Premium are enforced

#### Test 15: Backward Compatibility
1. Check existing clients (created before migration)
2. Verify:
   - ✓ Existing clients have `traffic_group_id = NULL`
   - ✓ Existing per-client speed limits still work
   - ✓ Existing per-client quotas still work
   - ✓ Can assign traffic group to existing client

---

### G. Edge Cases

#### Test 16: Cannot Delete Default Group
1. Try to delete the default traffic group
2. Verify:
   - ✓ Returns 400 error
   - ✓ Error message: "Cannot delete the default traffic group"

#### Test 17: Quota Enforcement
1. Create a group with 1 MB monthly quota
2. Assign client to this group
3. Generate traffic exceeding 1 MB
4. Verify:
   - ✓ Client is automatically disabled when quota exceeded
   - ✓ Audit log records quota.exceeded event

#### Test 18: Speed Limit Enforcement
1. Create a group with 100 Kbps speed limits
2. Assign client to this group
3. Test connection speed
4. Verify:
   - ✓ Speed is limited to ~100 Kbps
   - ✓ Limit applies to both upload and download

---

## Known Limitations

1. **Client Owner Picker**: The UI for selecting client owner during creation is deferred (PRD-60-05). Currently, clients are auto-assigned to auto-created end-users.

2. **Sub-account Client Creation**: Sub-accounts cannot create their own clients. Only the parent account can create clients and assign them to sub-accounts.

3. **Color Customization**: Traffic group colors are auto-generated and cannot be manually changed. To get a new color, delete and recreate the group.

4. **Migration Rollback**: The migration is forward-only. To rollback, you would need to manually drop the new columns and table.

---

## Troubleshooting

### Issue: Migration doesn't run
**Solution**: Check Docker logs. Migration runs automatically on container startup.

### Issue: Traffic group badge not showing
**Solution**: 
1. Check browser console for errors
2. Verify `/api/admin/traffic-groups` returns data
3. Ensure client has `trafficGroupId` set

### Issue: Sub-account can create clients
**Solution**: Check that validation in `/api/client/index.post.ts` is working. User should have `parentUserId` set.

### Issue: Colors look wrong in dark mode
**Solution**: Verify `useColorMode()` is working. Check Tailwind dark mode configuration.

---

## API Endpoints Reference

### Traffic Groups
- `GET /api/admin/traffic-groups` - List all groups
- `POST /api/admin/traffic-groups` - Create group
- `PATCH /api/admin/traffic-groups/[id]` - Update group
- `DELETE /api/admin/traffic-groups/[id]` - Delete group (auto-reassigns clients)
- `POST /api/admin/traffic-groups/[id]/set-default` - Set as default

### Sub-accounts
- `POST /api/admin/users/[id]/sub-accounts` - Create sub-account
- `GET /api/admin/users/[id]` - Get user with sub-accounts list

### Client Creation (Updated)
- `POST /api/client` - Now accepts `trafficGroupId` parameter

---

## Success Criteria

All phases completed:
- ✅ Phase 1: Database & Core Logic (Backend)
- ✅ Phase 2: Traffic Groups API
- ✅ Phase 3: Traffic Groups Enforcement
- ✅ Phase 4: Traffic Groups UI
- ✅ Phase 5: Sub-accounts API
- ✅ Phase 6: Sub-accounts UI
- ✅ Phase 7: Integration & Testing

The implementation is complete and ready for testing!
