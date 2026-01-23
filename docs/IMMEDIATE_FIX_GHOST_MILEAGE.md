# 🚨 IMMEDIATE FIX: Ghost Mileage Log

**Your specific record:** Jan 22, 2026, 26.60 miles, 2022 Chevrolet Colorado

---

## ✅ Method 1: Use Browser Console (RECOMMENDED)

### Step 1: Open Console

Press **F12** → Click **Console** tab

### Step 2: Check What's in Your Database

```javascript
// This will show what's stored locally
await window.debugGRY.showDBStats();
```

### Step 3: Find Your User ID

```javascript
// Copy your user ID from here
console.log('My User ID:', window.$page?.data?.user?.id);
```

### Step 4: Run Full Audit

Replace `'YOUR_USER_ID'` with the actual ID from step 3:

```javascript
await window.debugGRY.auditMileageSync('YOUR_USER_ID');
```

This will show which records are orphaned.

### Step 5: Clean Up

```javascript
await window.debugGRY.clearOrphanedMileage('YOUR_USER_ID');
```

### Step 6: Reload

```javascript
location.reload();
```

---

## ✅ Method 2: Use Settings UI

1. Go to **Dashboard → Settings**
2. Scroll to **"Data Cleanup"** section
3. Click **"Scan & Clean Up"**
4. Check console (F12) for detailed logs
5. Refresh page if records were removed

---

## 🔍 Troubleshooting: If Console Shows 0 Records

The issue is likely that the userId in IndexedDB doesn't match your current user ID.

### Check What's Actually in IndexedDB:

```javascript
// See ALL mileage records (all users)
await window.debugGRY.listAllMileage();
```

Look at the output - you'll see the `userId` field. That's the userId the record was saved under.

### Then use THAT userId for cleanup:

```javascript
// Use the userId you saw in listAllMileage()
await window.debugGRY.clearOrphanedMileage('THE_USERID_FROM_ABOVE');
location.reload();
```

---

## 🔧 Alternative: Manual IndexedDB Deletion

If console commands don't work:

1. Press **F12** → **Application** tab
2. Left sidebar → **IndexedDB** → **go-route-yourself** → **mileage**
3. Find the record (look for date Jan 22, 2026, miles 26.60)
4. Right-click the record → **Delete**
5. **Refresh the page**

---

## 📊 Debug Output to Share

If it still doesn't work, run these and share the output:

```javascript
// 1. Database stats
await window.debugGRY.showDBStats();

// 2. All mileage records
await window.debugGRY.listAllMileage();

// 3. Your current user info
console.log('Current user:', window.$page?.data?.user);
```

Copy the console output and share it for further troubleshooting.

---

## 🎯 Expected Console Output (After Fix)

You should see:

```
🔍 identifyOrphanedMileage called with userId: your-user-id
📦 Using mileage store: mileage
📊 Total mileage records in IndexedDB (all users): 1
Sample record: { id: "...", userId: "...", miles: 26.60, ... }
UserIds in DB: ["the-actual-userid"]
📊 Mileage records for user 'your-user-id': 1
🗑️ Removing orphaned mileage log: ...
✅ Removed 1 orphaned mileage logs
```

Then the ghost record should disappear after reloading!

---

**Need Help?** Run the debug commands above and share the console output.
