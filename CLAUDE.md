# NiceHash Pool Manager

## Overview

This is a focused React + Vite application for verifying mining pool connectivity and configuration. The backend proxy server (`index.js`) authenticates and forwards API requests to NiceHash using your credentials.

## Project Structure

```
├── src/
│   ├── components/
│   │   ├── Pools.jsx           # Main stratum pools verification component
│   │   ├── PoolEditorPopup.jsx # Pool editor modal wrapper
│   │   ├── PoolEditor.jsx      # Pool editing interface
│   │   ├── Modal.jsx           # Generic modal component
│   │   ├── poolUtils.js        # Pool verification utilities
│   │   └── pools.xlsx          # Sample export file
│   ├── App.jsx                 # Main app component
│   └── App.css                 # Global styles
├── index.js                    # Backend Express server
├── index.html                  # HTML entry point
├── vite.config.js              # Vite configuration
├── package.json                # Dependencies
└── wrangler.toml               # Cloudflare Workers config
```

## Features

### Pools Component - Stratum Pool Verification

**Main Capabilities**:
- Select and verify mining pools with customizable verification delay
- Continuous automated verification every 15 minutes
- Real-time tracking of run count, elapsed time, and next run countdown
- Algorithm-based pool grouping and filtering
- Export verification results to XLSX format

**State Management**:
- `pools`: List of configured pools
- `selected`: Currently selected pool
- `verifyResults`: Results from latest verification run
- `runCount`: Number of times the auto-run has executed
- `currentRunElapsed`: Seconds elapsed in current run
- `nextRunCountdown`: Seconds until next scheduled run
- `lastRunTime`: Completion timestamp of last run

**Key Functions**:
- `startRun()`: Initiates 15-minute interval loop with `setTimeout` (prevents duplicate runs)
- `verifyAllOnce()`: Single verification pass of selected pools
- `verifyAlgorithm()`: Verify pools by specific algorithm
- `stopAutomation()`: Stop auto-run and clear all timers
- `verify()`: Verify single selected pool

**UI Components**:
- Pool selection dropdown
- Algorithm summary sidebar with per-algorithm verify buttons
- Verification delay input (milliseconds)
- Auto Run button with run metrics display
- Progress bar during verification
- Results table with inspection and edit capabilities
- Export to XLSX button

### Pool Editing

- **PoolEditorPopup.jsx**: Modal wrapper for pool editing
- **PoolEditor.jsx**: Full pool editing interface with field validation
- **Modal.jsx**: Reusable modal component for dialogs

### Backend Server (index.js)

Provides secure proxy for NiceHash API v2:
- Authenticates using API key/secret/organization ID
- Forwards `/api/v2/*` requests to NiceHash
- Handles rate limiting (429 responses) with automatic retry
- Supports custom headers and request modification

## Development

**Setup**:
```bash
npm install
npm run all  # Runs backend + frontend concurrently
```

**Services**:
- Frontend: `http://localhost:5173` (Vite dev server)
- Backend: `http://localhost:3000` (Express server)

**Environment Variables** (`.env`):
```
NICEHASH_API_KEY=your_api_key
NICEHASH_API_SECRET=your_api_secret
NICEHASH_ORG_ID=your_org_id
NICEHASH_ENVIRONMENT=production
```

## Implementation Details

### Auto-Run Mechanism
- **Interval**: 15 minutes (900000ms) between cycles
- **Execution**: Each cycle runs to completion before next starts
- **Timing**: Uses `setTimeout` to schedule next cycle after countdown
- **Metrics**: Tracks run number, elapsed time, and next run countdown
- **Cleanup**: Properly clears all timers on stop

### Pool Verification
- Per-pool customizable delay (default 5000ms)
- Algorithm-aware grouping
- Stratum connectivity validation
- Result export to XLSX

### Rate Limiting
- Detects HTTP 429 responses
- Reads `Retry-After` header
- Auto-retries after delay
- Shows status to user

## Recent Changes

1. **Fixed duplicate runs**: Switched from `setInterval` to `setTimeout` pattern
2. **Added run metrics**: Run count, elapsed time, next run countdown
3. **UI refinement**: Moved timing info to status line below buttons
4. **Code cleanup**: Removed unused components (Accounting, HashpowerBot, MiningRig)

## Workflow

1. **Add/Configure Pools**: Use pool selector and editor
2. **Single Verification**: Click "Verify All" or "Verify" for algorithm
3. **Automated Monitoring**: Click "Auto Run (15m)" for continuous checks
4. **Review Results**: Click pool name to edit or "Inspect" to view raw data
5. **Export Data**: Click "Export Results" to save XLSX file

