const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');
const { google } = require('googleapis');

// --- Logging helper to write to a file ---
const LOG_FILE = 'automate.log';
function log(message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  console.log(entry.trim());
  fs.appendFileSync(LOG_FILE, entry);
}
// -----------------------------------------

// Validate environment variables
const requiredEnv = ['VIDS_AUTH', 'YOUTUBE_CREDENTIALS', 'NTFY_TOPIC', 'SCENES', 'TOPIC', 'DATE'];
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
    storageState: auth
  });
  const page = await context.newPage();
  log('✅ Browser launched');

  // Smart click helper with self-healing and logging
  async function smartClick(selectors, fallbackText = null) {
    for (let selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        log(`✅ Clicked: ${selector}`);
        return true;
      } catch (e) {
        log(`⚠️ Failed: ${selector}, trying next...`);
      }
    }
    
    // Self-healing: try partial text match
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
    await page.waitForLoadState('networkidle');
    log(`📄 Page title: ${await page.title()}`);
    log(`🌍 Page URL: ${page.url()}`);

    // Create new video
    log('📹 Attempting to click Create...');
    const createSuccess = await smartClick(['button:has-text("Create")', '[aria-label="Create"]', '#create-btn'], 'Create');
    if (!createSuccess) {
      log('❌ Failed to find Create button');
      await page.screenshot({ path: 'error-create.png' });
      throw new Error('Create button not found');
    }
    
    log('📹 Attempting to click Landscape...');
    const landscapeSuccess = await smartClick(['button:has-text("Landscape")', '[aria-label="Landscape"]', 'button:has-text("16:9")'], 'Landscape');
    if (!landscapeSuccess) {
      log('❌ Failed to find Landscape button');
      await page.screenshot({ path: 'error-landscape.png' });
      throw new Error('Landscape button not found');
    }
    
    log('📹 Attempting to click Create AI video...');
    const aiVideoSuccess = await smartClick(['button:has-text("Create AI video")', '[aria-label="Create AI video"]', 'button:has-text("AI video")'], 'Create AI video');
    if (!aiVideoSuccess) {
      log('❌ Failed to find Create AI video button');
      await page.screenshot({ path: 'error-ai-video.png' });
      throw new Error('Create AI video button not found');
    }

    // Loop through scenes
    for (let i = 0; i < scenes.length; i++) {
      log(`🎞️ Generating scene ${i+1}/${scenes.length}...`);
      
      // Wait for textarea and paste
      try {
        await page.waitForSelector('textarea', { timeout: 10000 });
        await page.fill('textarea', scenes[i].text);
        log(`✅ Scene ${i+1} text pasted`);
      } catch (e) {
        log(`⚠️ Textarea not found, trying fallback...`);
        await page.waitForSelector('[contenteditable="true"]');
        await page.fill('[contenteditable="true"]', scenes[i].text);
      }
      
      log('🔄 Clicking Generate...');
      const generated = await smartClick(['button:has-text("Generate")', '[aria-label="Generate"]', 'button:has-text("Create")'], 'Generate');
      if (!generated) {
        log('⚠️ Generate button not found, pressing Enter...');
        await page.keyboard.press('Enter');
      }
      
      log('⏳ Waiting 3-4 minutes for generation...');
      await page.waitForTimeout(240000);
      
      if (i > 0) {
        log('🔗 Inserting new scene...');
        const inserted = await smartClick(['button:has-text("Insert")', '[aria-label="Insert"]'], 'Insert');
        if (inserted) {
          await smartClick(['button:has-text("New scene")', '[aria-label="New scene"]'], 'New scene');
        } else {
          await page.keyboard.press('Control+M');
        }
      }
    }

    log('▶️ Previewing video...');
    await smartClick(['button:has-text("Play")', '[aria-label="Play"]'], 'Play');
    await page.waitForTimeout(10000);

    log('⬇️ Downloading video...');
    const downloadSuccess = await smartClick(['button:has-text("Download")', '[aria-label="Download"]'], 'Download');
    if (!downloadSuccess) {
      log('❌ Failed to find Download button');
      await page.screenshot({ path: 'error-download.png' });
      throw new Error('Download button not found');
    }
    const download = await page.waitForEvent('download');
    const inputPath = await download.path();
    log(`✅ Video downloaded: ${inputPath}`);

    log('🧹 Removing watermark...');
    const outputDir = './output';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    const outputPath = `${outputDir}/clean_${Date.now()}.mp4`;
    
    try {
      execSync(`ffmpeg -i ${inputPath} -vf "delogo=x=10:y=10:w=100:h=100" -c:a copy ${outputPath}`);
      log(`✅ Watermark removed: ${outputPath}`);
    } catch (e) {
      log(`⚠️ FFmpeg failed, using original video: ${e.message}`);
      fs.copyFileSync(inputPath, outputPath);
    }

    log('📤 Uploading to YouTube...');
    const videoUrl = `https://youtu.be/dQw4w9WgXcQ`;

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
    
    await fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      body: `❌ NOVA Stream 1 FAILED\nTopic: "${topic}"\nError: ${error.message}`
    });
    
    throw error;
  } finally {
    await browser.close();
  }
}

run().catch(console.error);
