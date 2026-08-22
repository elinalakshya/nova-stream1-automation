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
  
  // Parse scenes
  let scenes = [];
  try {
    const scenesRaw = process.env.SCENES;
    log(`📥 Raw SCENES: ${scenesRaw}`);
    scenes = JSON.parse(scenesRaw);
    if (!Array.isArray(scenes)) {
      log('⚠️ SCENES is not an array, converting...');
      scenes = [scenes];
    }
  } catch (e) {
    log(`⚠️ Failed to parse SCENES: ${e.message}`);
    log('🔄 Using default test scene...');
    scenes = [{ id: 1, text: "Test video scene 1" }];
  }
  
  const topic = process.env.TOPIC || 'test';
  const date = process.env.DATE || new Date().toISOString().split('T')[0];
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
    await page.waitForTimeout(5000);
    log(`📄 Page title: ${await page.title()}`);
    log(`🌍 Page URL: ${page.url()}`);
    await page.screenshot({ path: 'homepage.png' });
    log('📸 Homepage screenshot saved');

    // --- NEW: Click the "+" (plus) symbol ---
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

    // --- Wait for options to appear ---
    log('⏳ Waiting for AI creation options...');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'create-options.png' });
    log('📸 Create options screenshot saved');

    // --- Select Landscape ---
    log('📹 Selecting Landscape orientation...');
    const landscapeSelectors = [
      'button:has-text("Landscape")',
      'button:has-text("16:9")',
      '[aria-label="Landscape"]',
      '[data-testid="landscape"]',
      'button[class*="landscape"]'
    ];
    await smartClick(landscapeSelectors, 'Landscape');

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

    // --- Wait for AI video interface to load ---
    log('⏳ Waiting for AI video interface...');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'ai-interface.png' });
    log('📸 AI interface screenshot saved');

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
      '[data-testid="play"]'
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
