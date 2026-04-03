// Simple icon generator for PopoutPlayer
// Creates basic PNG icons with a PiP-style design

const fs = require('fs');
const path = require('path');

// Create a simple PNG programmatically
// This creates a minimal PNG with a colored square and a PiP-style icon
function createIcon(size, outputPath) {
  // For simplicity, we'll create SVG and save instructions to convert
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background gradient -->
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2196F3;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1976D2;stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="url(#grad)"/>

  <!-- PiP icon (simplified) -->
  <g transform="translate(${size * 0.25}, ${size * 0.25})">
    <!-- Outer rectangle -->
    <rect x="0" y="0" width="${size * 0.5}" height="${size * 0.5}"
          fill="none" stroke="white" stroke-width="${size * 0.08}" rx="${size * 0.05}"/>
    <!-- Inner rectangle (PiP window) -->
    <rect x="${size * 0.15}" y="${size * 0.25}" width="${size * 0.2}" height="${size * 0.15}"
          fill="white" rx="${size * 0.02}"/>
  </g>
</svg>`;

  fs.writeFileSync(outputPath, svg);
  console.log(`Created SVG: ${outputPath}`);
}

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate SVG files (we'll convert to PNG manually or use these as-is)
createIcon(16, path.join(iconsDir, 'icon16.svg'));
createIcon(48, path.join(iconsDir, 'icon48.svg'));
createIcon(128, path.join(iconsDir, 'icon128.svg'));

console.log('\nSVG icons created! To convert to PNG, you can:');
console.log('1. Use an online converter (e.g., cloudconvert.com)');
console.log('2. Use ImageMagick: convert icon.svg icon.png');
console.log('3. Use Inkscape: inkscape icon.svg --export-png=icon.png');
console.log('\nOr use the SVG files directly by updating manifest.json to point to .svg files.');

// Create a simple base64-encoded 1x1 PNG as fallback
const minimalPNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// For now, let's create actual small PNG files
// This is a minimal valid PNG (blue square)
function createMinimalPNG(size, color) {
  // For a production app, you'd use a proper image library
  // For now, we'll create a script that requires manual conversion
  // or we'll use base64 embedded minimal PNGs

  // Base64 of a 1x1 blue PNG
  const bluePNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  return Buffer.from(bluePNG, 'base64');
}

// Create minimal PNG fallbacks
['16', '48', '128'].forEach(size => {
  const pngPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(pngPath, createMinimalPNG(parseInt(size), '#2196F3'));
  console.log(`Created minimal PNG fallback: ${pngPath}`);
});

console.log('\nNote: The PNG files are minimal placeholders.');
console.log('Use the generated SVG files and convert them for better quality icons.');
