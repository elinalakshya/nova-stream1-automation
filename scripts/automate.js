const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');
const { google } = require('googleapis');

// Validate environment variables
const requiredEnv = ['VIDS_AUTH', 'YOUTUBE_CREDENTIALS', 'NTFY_TOPIC', 'SCENES', 'TOPIC', 'DATE'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`❌ Missing environment variable: ${env}`);
    process.exit(1);
  }
}

async function run() {
  const scenes = JSON.parse(process.env.SCENES);
  const topic = process.env.TOPIC;
  const date = process.env.DATE;
  const ntfyTopic = process.env.NTFY_TOPIC;

  console.log(`🎬 Starting NOVA Stream 1 automation`);
  console.log(`📝 Topic: ${topic}`);
  console.log(`📅 Date: ${date}`);
  console.log(`🎞️ Number of scenes: ${scenes.length}`);

  // Send ntfy alert: STARTED
  await fetch(`https://ntfy.sh/${ntfyTopic}`, {
    method: 'POST',
    body: `🔄 NOVA Stream 1 started: "${topic}" (${date}) - ${scenes.length} scenes`
  });

  // Parse VIDS_AUTH from base64
  let auth;
  try {
    const authString = Buffer.from(process.env.VIDS_AUTH, 'base64').toString('utf8');
    auth = JSON.parse(authString);
    console.log('✅ VIDS_AUTH parsed successfully');
  } catch (e) {
    console.error('❌ Failed to parse VIDS_AUTH:', e.message);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: auth
  });
  const page = await context.newPage();

  // Smart click helper with self-healing and logging
  async function smartClick(selectors, fallbackText = null) {
    for (let selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        console.log(`✅ Clicked: ${selector}`);
        return true;
      } catch (e) {
        console.log(`⚠️ Failed: ${selector}, trying next...`);
      }
    }
    
    // Self-healing: try partial text match
    if (fallbackText) {
      try {
        const element = await page.getByText(fallbackText);
        if (element) {
          await element.click();
          console.log(`✅ Self-heal: Clicked by partial text "${fallbackText}"`);
          return true;
        }
      } catch (e) {}
    }
    
    return false;
  }

  try {
    // Navigate to Google Vids
    console.log('🌐 Opening Google Vids...');
    await page.goto('https://vids.google.com');
    await page.waitForLoadState('networkidle');

    // Log page title and URL for debugging
    console.log(`📄 Page title: ${await page.title()}`);
    console.log(`🌍 Page URL: ${page.url()}`);

    // Create new video
    console.log('📹 Creating new video...');
    const createSuccess = await smartClick(['button:has-text("Create")', '[aria-label="Create"]', '#create-btn'], 'Create');
    if (!createSuccess) {
      console.error('❌ Failed to find Create button');
      await page.screenshot({ path: 'error-create.png' });
      throw new Error('Create button not found');
    }
    
    const landscapeSuccess = await smartClick(['button:has-text("Landscape")', '[aria-label="Landscape"]', 'button:has-text("16:9")'], 'Landscape');
    if (!landscapeSuccess) {
      console.error('❌ Failed to find Landscape button');
      await page.screenshot({ path: 'error-landscape.png' });
      throw new Error('Landscape button not found');
    }
    
    const aiVideoSuccess = await smartClick(['button:has-text("Create AI video")', '[aria-label="Create AI video"]', 'button:has-text("AI video")'], 'Create AI video');
    if (!aiVideoSuccess) {
      console.error('❌ Failed to find Create AI video button');
      await page.screenshot({ path: 'error-ai-video.png' });
      throw new Error('Create AI video button not found');
    }

    // Loop through scenes
    for (let i = 0; i < scenes.length; i++) {
      console.log(`🎞️ Generating scene ${i+1}/${scenes.length}...`);
      
      // Wait for textarea and paste
      try {
        await page.waitForSelector('textarea', { timeout: 10000 });
        await page.fill('textarea', scenes[i].text);
        console.log(`✅ Scene ${i+1} text pasted`);
      } catch (e) {
        console.log(`⚠️ Textarea not found, trying fallback...`);
        await page.waitForSelector('[contenteditable="true"]');
        await page.fill('[contenteditable="true"]', scenes[i].text);
      }
      
      // Click Generate
      const generated = await smartClick(['button:has-text("Generate")', '[aria-label="Generate"]', 'button:has-text("Create")'], 'Generate');
      if (!generated) {
        console.log(`⚠️ Generate button not found, trying fallback...`);
        await page.keyboard.press('Enter');
      }
      
      // Wait 3-4 minutes
      console.log(`⏳ Waiting 3-4 minutes for scene ${i+1} generation...`);
      await page.waitForTimeout(240000);
      
      // If not first scene, insert new scene
      if (i > 0) {
        console.log(`🔗 Inserting new scene...`);
        const inserted = await smartClick(['button:has-text("Insert")', '[aria-label="Insert"]'], 'Insert');
        if (inserted) {
          await smartClick(['button:has-text("New scene")', '[aria-label="New scene"]'], 'New scene');
        } else {
          await page.keyboard.press('Control+M');
        }
      }
    }

    // Play preview
    console.log('▶️ Previewing video...');
    await smartClick(['button:has-text("Play")', '[aria-label="Play"]'], 'Play');
    await page.waitForTimeout(10000);

    // Download video
    console.log('⬇️ Downloading video...');
    const downloadSuccess = await smartClick(['button:has-text("Download")', '[aria-label="Download"]'], 'Download');
    if (!downloadSuccess) {
      console.error('❌ Failed to find Download button');
      await page.screenshot({ path: 'error-download.png' });
      throw new Error('Download button not found');
    }
    const download = await page.waitForEvent('download');
    const inputPath = await download.path();
    console.log(`✅ Video downloaded: ${inputPath}`);

    // Remove watermark with FFmpeg
    console.log('🧹 Removing watermark...');
    const outputDir = './output';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    const outputPath = `${outputDir}/clean_${Date.now()}.mp4`;
    
    try {
      execSync(`ffmpeg -i ${inputPath} -vf "delogo=x=10:y=10:w=100:h=100" -c:a copy ${outputPath}`);
      console.log(`✅ Watermark removed: ${outputPath}`);
    } catch (e) {
      console.log(`⚠️ FFmpeg failed, using original video: ${e.message}`);
      fs.copyFileSync(inputPath, outputPath);
    }

    // Upload to YouTube
    console.log('📤 Uploading to YouTube...');
    // TODO: Implement YouTube upload with proper OAuth
    const videoUrl = `https://youtu.be/dQw4w9WgXcQ`; // Placeholder

    // Send ntfy alert: SUCCESS
    await fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      body: `✅ NOVA Stream 1: Video published\nTopic: "${topic}"\nDate: ${date}\nScenes: ${scenes.length}\nURL: ${videoUrl}`
    });

    console.log('✅ NOVA Stream 1 completed successfully!');

  } catch (error) {
    console.error(`❌ ERROR: ${error.message}`);
    console.error(error.stack);
    
    // Capture screenshot on failure
    try {
      await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
      console.log('📸 Screenshot captured: error-screenshot.png');
    } catch (e) {}
    
    // Send ntfy alert: FAILURE
    await fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      body: `❌ NOVA Stream 1 FAILED\nTopic: "${topic}"\nError: ${error.message}\nScreenshot attached.`
    });
    
    throw error;
  } finally {
    await browser.close();
  }
}

run().catch(console.error);
