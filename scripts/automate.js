// --- NEW: Click the "+" (plus) symbol to reveal AI video options ---
log('📹 Looking for "+" (plus) symbol to create new video...');
const plusSelectors = [
  'button:has-text("+")',
  'button[aria-label*="plus"]',
  'button[aria-label*="add"]',
  'button[class*="add"]',
  'button[class*="plus"]',
  '[data-testid="create-new"]',
  'button:has-text("＋")'
];

let plusSuccess = await smartClick(plusSelectors, '+');

if (!plusSuccess) {
  // If plus button not found, try clicking the "Start a new video" card
  log('⚠️ "+" button not found, clicking "Start a new video" text...');
  const startSelectors = [
    'a:has-text("Start a new video")',
    'button:has-text("Start a new video")',
    'div:has-text("Start a new video")'
  ];
  plusSuccess = await smartClick(startSelectors, 'Start a new video');
}

if (!plusSuccess) {
  log('❌ Failed to find "+" button');
  await page.screenshot({ path: 'error-plus.png' });
  throw new Error('Plus button not found');
}

// --- Wait for the AI video creation options to appear ---
log('⏳ Waiting for AI creation options...');
await page.waitForTimeout(3000);

// --- Take screenshot of the options ---
await page.screenshot({ path: 'create-options.png' });
log('📸 Create options screenshot saved');

// --- Now select Landscape ---
log('📹 Selecting Landscape orientation...');
const landscapeSelectors = [
  'button:has-text("Landscape")',
  'button:has-text("16:9")',
  '[aria-label="Landscape"]',
  '[data-testid="landscape"]',
  'button[class*="landscape"]'
];
const landscapeSuccess = await smartClick(landscapeSelectors, 'Landscape');
if (!landscapeSuccess) {
  log('⚠️ Landscape option not found, trying to continue...');
}

// --- Click Create AI video ---
log('📹 Looking for Create AI video button...');
const aiSelectors = [
  'button:has-text("Create AI video")',
  'button:has-text("AI video")',
  '[aria-label="Create AI video"]',
  '[data-testid="ai-video"]',
  'button[class*="ai-video"]'
];
const aiSuccess = await smartClick(aiSelectors, 'AI video');
if (!aiSuccess) {
  log('⚠️ Create AI video button not found');
  await page.screenshot({ path: 'error-ai-video.png' });
  throw new Error('Create AI video button not found');
}
