# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Migrated to Svelte 5

<!-- List files migrated to Svelte 5 with dates -->

_None yet._

### Added (Svelte 5)

<!-- New features/components built with Svelte 5 -->

- **Orphaned Mileage Cleanup Tool** (2026-01-22)
  - Added `OrphanedMileageCleanup.svelte` component in Settings → Data Cleanup
  - Detects and removes mileage logs that exist in IndexedDB but not on server
  - Visual scan results with detailed reporting
  - One-click cleanup with progress indicator

- **Debug Utilities** (2026-01-22)
  - Added `debug-helpers.ts` with browser console commands
  - Exposed as `window.debugGRY` in development mode
  - Commands: `listOrphanedMileage()`, `clearOrphanedMileage()`, `auditMileageSync()`, etc.
  - Comprehensive IndexedDB inspection tools

### Changed (Svelte 4)

<!-- Changes to existing Svelte 4 files without migration -->

_None yet._

### Fixed

<!-- Bug fixes -->

- **Ghost Mileage Logs** (2026-01-22) 🐛
  - Fixed persistent "zombie" mileage logs that couldn't be deleted
  - DELETE endpoint now logs warning when record doesn't exist in KV
  - Returns 204 status to allow client cleanup even when record is missing
  - Improved logging for troubleshooting orphaned records
  - Added utilities to detect and remove orphaned records from IndexedDB
  - Files changed:
    - `src/routes/api/mileage/[id]/+server.ts` - Enhanced DELETE handler
    - `src/lib/utils/cleanup-orphaned-mileage.ts` - New cleanup utility
    - `src/routes/dashboard/settings/+page.svelte` - Added Data Cleanup section
  - Documentation:
    - `docs/ORPHANED_MILEAGE_TROUBLESHOOTING.md` - Comprehensive guide
    - `docs/ORPHANED_MILEAGE_FIX_SUMMARY.md` - Technical summary
    - `docs/QUICK_FIX_GHOST_MILEAGE.md` - Quick reference card

### Security

<!-- Security improvements -->

_None yet._

### Deprecated

<!-- Features marked for removal -->

_None yet._

### Removed

<!-- Removed features -->

_None yet._

---

## Migration Progress

### Completed

- [ ] Utility modules
- [ ] Stores
- [ ] Leaf components
- [ ] Shared UI components
- [ ] Pages/routes
- [ ] Root layout & app shell

### Statistics

- **Total Svelte files:** TBD
- **Migrated to Svelte 5:** 0
- **Remaining Svelte 4:** TBD
- **Migration progress:** 0%

---

## Example Entries

### [1.0.0] - 2024-01-19

### Security

- Added comprehensive SECURITY.md with Cloudflare KV guidelines
- Implemented API authentication for trip data
- Added user ownership verification in all API endpoints

### Migrated to Svelte 5

- `src/lib/components/Button.svelte` - 2024-01-19
  - Migrated from Svelte 4 to Svelte 5
  - Converted `export let` to `$props()`
  - Converted reactive statements to `$derived`
  - No API changes, fully backward compatible

### Added (Svelte 5)

- `src/lib/components/TripCard.svelte` - 2024-01-19
  - New feature component built with Svelte 5
  - Uses `$state` for local state management
  - Fully PWA compatible

### Changed (Svelte 4)

- `src/routes/+page.svelte` - 2024-01-19
  - Fixed typo in page title
  - Updated button text
  - No migration performed (minor edit only)

### Fixed

- `src/lib/utils/format.ts` - 2024-01-19
  - Fixed date formatting bug
  - No Svelte version impact

---

## Notes

- This changelog tracks both Svelte 4/5 changes and regular updates
- Migration entries should note API compatibility
- All entries should include dates
- Breaking changes should be clearly marked with ⚠️
- Security changes should be documented in dedicated section
