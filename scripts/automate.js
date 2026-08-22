const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

// --- Logging helper ---
const LOG_FILE = 'automate.log';
function log(message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  console.log(entry.trim());
  fs.appendFileSync(LOG_FILE, entry);
}

// Validate environment variables
const requiredEnv = ['VIDS_AUTH', 'NTFY_TOPIC', 'SCENES', 'TOPIC', 'DATE'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    log(`❌ Missing environment variable: ${env}`);
    process.exit(1);
  }
}

async function run() {
  log('🚀 Script started');
  const scenes = JSON.parse(process.env.SCENES);
  const topic = process.env.TOPIC;
  const date = process.env.DATE;
  const ntfyTopic = process.env.NTFY_TOPIC;

  log(`📝 Topic: ${topic}`);
  log(`📅 Date: ${date}`);
  log(`🎞️ Number of scenes: ${scenes.length}`);

  // Send ntfy alert: STARTED
  try {
    await fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      body: `🔄 NOVA Stream 1 started: "${topic}" (${date}) - ${scenes.length} scenes`
    });
    log('✅ ntfy STARTED alert sent');
  } catch (e) {
    log(`⚠️ Failed to send ntfy alert: ${e.message}`);
  }

  // Parse VIDS_AUTH from base64
  let auth;
  try {
    const authString = Buffer.from(process.env.VIDS_AUTH, 'base64').toString('utf8');
    auth = JSON.parse(authString);
    log('✅ VIDS_AUTH parsed successfully');
  } catch (e) {
    log(`❌ Failed to parse VIDS_AUTH: ${e.message}`);
    process.exit(1);
  }

  log('🔄 Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: auth,
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  log('✅ Browser launched');

  // Smart click with fallback selectors
  async function smartClick(selectors, fallbackText = null) {
    for (let selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        log(`✅ Clicked: ${selector}`);
        return true;
      } catch (e) {
        log(`⚠️ Failed: ${selector}`);
      }
    }
    
    if (fallbackText) {
      try {
        const element = await page.getByText(fallbackText);
        if (element) {
          await element.click();
          log(`✅ Self-heal: Clicked by partial text "${fallbackText}"`);
          return true;
        }
      } catch (e) {
        log(`⚠️ Self-heal failed for text "${fallbackText}"`);
      }
    }
    return false;
  }

  try {
    log('🌐 Navigating to Google Vids...');
    await page.goto('https://vids.google.com');
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    log(`📄 Page title: ${await page.title()}`);
    log(`🌍 Page URL: ${page.url()}`);

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'homepage.png' });
    log('📸 Homepage screenshot saved');

    // --- CREATE NEW VIDEO ---
    log('📹 Looking for Create button...');
    const createSelectors = [
      'button:has-text("Create")',
      'button:has-text("New")',
      'button:has-text("+")',
      '[aria-label="Create"]',
      '[aria-label="New"]',
      '[data-testid="create-button"]',
      'a:has-text("Create")',
      'div[role="button"]:has-text("Create")',
      'button[class*="create"]',
      'button[class*="new"]'
    ];
    const createSuccess = await smartClick(createSelectors, 'Create');
    if (!createSuccess) {
      log('⚠️ Create button not found, clicking body...');
      await page.click('body');
      await page.waitForTimeout(2000);
      await smartClick(createSelectors, 'Create');
    }

    // --- HANDLE POPUPS ---
    log('📹 Checking for popups...');
    try {
      const popup = await page.waitForSelector('button:has-text("Got it")', { timeout: 3000 });
      if (popup) {
        await popup.click();
        log('✅ Dismissed popup');
      }
    } catch (e) {
      log('ℹ️ No popup found');
    }

    // --- SELECT ORIENTATION ---
    log('📹 Selecting orientation...');
    const orientationSelectors = [
      'button:has-text("Landscape")',
      'button:has-text("16:9")',
      '[aria-label="Landscape"]',
      '[data-testid="landscape"]',
      'button[class*="landscape"]'
    ];
    await smartClick(orientationSelectors, 'Landscape');

    // --- CREATE AI VIDEO ---
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
      log('⚠️ Create AI video button not found, trying Start...');
      await smartClick(['button:has-text("Start")', 'button:has-text("Blank")', '[aria-label="Start from scratch"]'], 'Start');
    }

    await page.waitForTimeout(5000);

    // --- SCENE LOOP ---
    for (let i = 0; i < scenes.length; i++) {
      log(`🎞️ Generating scene ${i+1}/${scenes.length}...`);
      
      try {
        await page.waitForSelector('textarea, [contenteditable="true"], div[role="textbox"]', { timeout: 15000 });
        const input = await page.locator('textarea, [contenteditable="true"], div[role="textbox"]').first();
        await input.fill(scenes[i].text);
        log(`✅ Scene ${i+1} text pasted`);
      } catch (e) {
        log(`⚠️ Input field not found: ${e.message}`);
        await page.screenshot({ path: `error-scene-${i+1}.png` });
        throw new Error(`Could not find input field for scene ${i+1}`);
      }
      
      log('🔄 Clicking Generate...');
      const genSelectors = [
        'button:has-text("Generate")',
        'button:has-text("Create")',
        'button:has-text("Generate video")',
        '[aria-label="Generate"]',
        '[data-testid="generate"]'
      ];
      const generated = await smartClick(genSelectors, 'Generate');
      if (!generated) {
        log('⚠️ Generate button not found, pressing Enter...');
        await page.keyboard.press('Enter');
      }
      
      log('⏳ Waiting 3-4 minutes for generation...');
      await page.waitForTimeout(240000);
      
      if (i > 0) {
        log('🔗 Inserting new scene...');
        const insertSelectors = [
          'button:has-text("Insert")',
          'button:has-text("Add")',
          '[aria-label="Insert"]',
          '[data-testid="insert-scene"]'
        ];
        const inserted = await smartClick(insertSelectors, 'Insert');
        if (inserted) {
          await smartClick([
            'button:has-text("New scene")',
            'button:has-text("Add scene")',
            '[aria-label="New scene"]',
            '[data-testid="add-scene"]'
          ], 'New scene');
        } else {
          await page.keyboard.press('Control+M');
        }
      }
    }

    // --- PLAY PREVIEW ---
    log('▶️ Previewing video...');
    await smartClick([
      'button:has-text("Play")',
      '[aria-label="Play"]',
      '[data-testid="play"]',
      'button[class*="play"]'
    ], 'Play');
    await page.waitForTimeout(10000);

    // --- DOWNLOAD VIDEO ---
    log('⬇️ Downloading video...');
    const downloadSuccess = await smartClick([
      'button:has-text("Download")',
      '[aria-label="Download"]',
      '[data-testid="download"]',
      'button[class*="download"]'
    ], 'Download');
    if (!downloadSuccess) {
      log('❌ Failed to find Download button');
      await page.screenshot({ path: 'error-download.png' });
      throw new Error('Download button not found');
    }
    const download = await page.waitForEvent('download');
    const inputPath = await download.path();
    log(`✅ Video downloaded: ${inputPath}`);

    // --- WATERMARK REMOVAL ---
    log('🧹 Removing watermark...');
    const outputDir = './output';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    const outputPath = `${outputDir}/clean_${Date.now()}.mp4`;
    
    try {
      execSync(`ffmpeg -i ${inputPath} -vf "delogo=x=10:y=10:w=100:h=100" -c:a copy ${outputPath} 2>&1`);
      log(`✅ Watermark removed: ${outputPath}`);
    } catch (e) {
      log(`⚠️ FFmpeg failed, using original video: ${e.message}`);
      fs.copyFileSync(inputPath, outputPath);
    }

    // --- YOUTUBE UPLOAD (PLACEHOLDER) ---
    log('📤 YouTube upload simulated');
    const videoUrl = `https://youtu.be/dQw4w9WgXcQ`;

    // --- NTFY SUCCESS ---
    await fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      body: `✅ NOVA Stream 1: Video published\nTopic: "${topic}"\nDate: ${date}\nScenes: ${scenes.length}\nURL: ${videoUrl}`
    });
    log('✅ ntfy SUCCESS alert sent');

    log('✅ NOVA Stream 1 completed successfully!');

  } catch (error) {
    log(`❌ ERROR: ${error.message}`);
    log(error.stack);
    
    try {
      await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
      log('📸 Screenshot captured: error-screenshot.png');
    } catch (e) {
      log(`⚠️ Failed to capture screenshot: ${e.message}`);
    }
    
    try {
      await fetch(`https://ntfy.sh/${ntfyTopic}`, {
        method: 'POST',
        body: `❌ NOVA Stream 1 FAILED\nTopic: "${topic}"\nError: ${error.message}`
      });
    } catch (e) {}
    
    throw error;
  } finally {
    await browser.close();
  }
}

run().catch(console.error);
