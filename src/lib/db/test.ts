// src/lib/db/test.ts
import { getDB, getDBStats, clearDatabase } from './indexedDB';
import type { TripRecord } from './types';

/**
 * Test IndexedDB functionality
 * 
 * Run this in browser console:
 * import { testIndexedDB } from '$lib/db/test';
 * testIndexedDB();
 */
export async function testIndexedDB() {
  console.log('🧪 Testing IndexedDB...\n');

  try {
    // 1. Open database
    console.log('1️⃣ Opening database...');
    const db = await getDB();
    console.log('✅ Database opened:', db.name);

    // 2. Check stats (should be empty)
    console.log('\n2️⃣ Checking initial stats...');
    const initialStats = await getDBStats();
    console.log('✅ Initial stats:', initialStats);

    // 3. Add a test trip
    console.log('\n3️⃣ Adding test trip...');
    const testTrip: TripRecord = {
      id: 'test-' + Date.now(),
      userId: 'test-user',
      date: '2024-12-06',
      startAddress: '123 Main St',
      totalMiles: 50,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending',
    };

    const tx1 = db.transaction('trips', 'readwrite');
    await tx1.objectStore('trips').add(testTrip);
    await tx1.done;
    console.log('✅ Test trip added:', testTrip.id);

    // 4. Read it back
    console.log('\n4️⃣ Reading trip back...');
    const tx2 = db.transaction('trips', 'readonly');
    const retrieved = await tx2.objectStore('trips').get(testTrip.id);
    console.log('✅ Retrieved trip:', retrieved);

    // 5. Check stats again
    console.log('\n5️⃣ Checking updated stats...');
    const updatedStats = await getDBStats();
    console.log('✅ Updated stats:', updatedStats);

    // 6. Query by index
    console.log('\n6️⃣ Testing index query...');
    const tx3 = db.transaction('trips', 'readonly');
    const byUser = await tx3.objectStore('trips').index('userId').getAll('test-user');
    console.log('✅ Trips for test-user:', byUser.length);

    // 7. Update the trip
    console.log('\n7️⃣ Updating trip...');
    const updated = {
      ...testTrip,
      totalMiles: 100,
      updatedAt: new Date().toISOString(),
      syncStatus: 'synced' as const,
    };
    const tx4 = db.transaction('trips', 'readwrite');
    await tx4.objectStore('trips').put(updated);
    await tx4.done;
    console.log('✅ Trip updated');

    // 8. Delete the trip
    console.log('\n8️⃣ Deleting trip...');
    const tx5 = db.transaction('trips', 'readwrite');
    await tx5.objectStore('trips').delete(testTrip.id);
    await tx5.done;
    console.log('✅ Trip deleted');

    // 9. Final stats
    console.log('\n9️⃣ Final stats...');
    const finalStats = await getDBStats();
    console.log('✅ Final stats:', finalStats);

    console.log('\n✅ All tests passed! IndexedDB is working correctly.');
    
    return true;
  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

/**
 * Add some dummy data for testing UI
 */
export async function addDummyData() {
  console.log('🎭 Adding dummy data...');

  const db = await getDB();
  const tx = db.transaction('trips', 'readwrite');
  const store = tx.objectStore('trips');

  const dummyTrips: TripRecord[] = [
    {
      id: 'dummy-1',
      userId: 'test-user',
      date: '2024-12-01',
      startAddress: '123 Main St, Springfield',
      endAddress: '456 Oak Ave, Springfield',
      totalMiles: 25.5,
      hoursWorked: 8,
      mpg: 30,
      gasPrice: 3.50,
      fuelCost: 2.98,
      createdAt: '2024-12-01T08:00:00Z',
      updatedAt: '2024-12-01T16:00:00Z',
      syncStatus: 'synced',
    },
    {
      id: 'dummy-2',
      userId: 'test-user',
      date: '2024-12-02',
      startAddress: '789 Pine Rd, Springfield',
      totalMiles: 45.2,
      hoursWorked: 6.5,
      createdAt: '2024-12-02T09:00:00Z',
      updatedAt: '2024-12-02T15:30:00Z',
      syncStatus: 'pending',
    },
    {
      id: 'dummy-3',
      userId: 'test-user',
      date: '2024-12-03',
      startAddress: '321 Elm St, Springfield',
      endAddress: '654 Maple Dr, Springfield',
      totalMiles: 38.7,
      hoursWorked: 7.5,
      notes: 'Heavy traffic on highway',
      createdAt: '2024-12-03T07:30:00Z',
      updatedAt: '2024-12-03T15:00:00Z',
      syncStatus: 'synced',
    },
  ];

  for (const trip of dummyTrips) {
    await store.add(trip);
  }

  await tx.done;

  const stats = await getDBStats();
  console.log('✅ Dummy data added:', stats);
}

/**
 * Clear all dummy data
 */
export async function clearDummyData() {
  console.log('🗑️ Clearing all data...');
  await clearDatabase();
  console.log('✅ Data cleared');
}
