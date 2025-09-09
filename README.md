# 🐑 HexaFlock Sheep Generator

**Generate unique pixel art sheep from Bitcoin transaction IDs!**

Transform any Bitcoin TXID into a beautiful, deterministic pixel sheep with unique colors, traits, and characteristics. Each sheep is mathematically derived from its source transaction, creating one-of-a-kind digital collectibles.

## 🎯 Quick Start

### Option 1: Use the Live Website
Visit [www.hexaflock.com](https://www.hexaflock.com) to start generating sheep immediately!

### Option 2: Run Locally (No Installation Required)

**Simplest method - just open the HTML file:**
1. Download or clone this repository
2. Open `static_site/index.html` in your web browser
3. Start generating sheep!

**Using a local server (recommended for full functionality):**
```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve static_site

# PHP
php -S localhost:8000 -t static_site
```

Then visit `http://localhost:8000`

## 🎨 How to Use

1. **Enter a Bitcoin TXID**: Paste any 64-character hexadecimal Bitcoin transaction ID
2. **Generate Your Sheep**: Click "Generate" to create your unique pixel sheep
3. **Explore Traits**: View the automatically generated characteristics:
   - Body, eye, and snout colors (deterministically derived from TXID)
   - Wool density and shape
   - Leg pose and accessories
4. **Customize Display**:
   - Adjust scale with the slider
   - Toggle CRT effect for retro feel
5. **Share & Download**:
   - Copy permalink to share your sheep
   - Download as PNG image
   - Copy metadata as JSON

### Try a Demo
Click "Random TX (demo)" to generate a sheep from a random TXID!

## 🔧 Advanced Features

### URL Parameters
Share specific sheep by adding `?txid=YOUR_TXID` to the URL:
```
https://www.hexaflock.com/?txid=abcd1234...
```

### Stamping on Bitcoin (Optional)

For users who want to permanently record their sheep on the Bitcoin blockchain:

1. **Set up Backend**: Configure a backend API URL (defaults to hexaflock.com)
2. **Set Your Wallet**: Enter your Bitcoin address for PSBT generation
3. **Configure Fee Rate**: Set your preferred transaction fee
4. **Stamp Process**:
   - Click "Stamp on Bitcoin" to generate a PSBT
   - Sign the transaction in your Bitcoin wallet
   - Broadcast the signed transaction to mint your sheep permanently

## 🏗️ Development & Deployment

### For Developers

**Frontend (React)**:
```bash
cd frontend
npm install
npm run dev  # Development server
npm run build  # Production build
```

**Backend Setup** (Optional - for stamping functionality):
See `cloudflare-worker/README.md` for Cloudflare Worker deployment instructions.

### Project Structure
- `static_site/` - Standalone HTML/CSS/JS (no build required)
- `frontend/` - React-based frontend
- `cloudflare-worker/` - Backend API for Bitcoin stamping
- `docs/` - Documentation and examples

## 🎭 How It Works

### Deterministic Generation
Each sheep is uniquely determined by its Bitcoin TXID:
- **Colors**: Derived from TXID hash segments using HSL color space
- **Traits**: Procedurally generated with consistent randomness
- **Shape**: Fixed pixel-perfect silhouette with wool texture

### Technical Details
- **Resolution**: 24x24 pixel canvas
- **Color Derivation**: HSL values extracted from TXID hex segments
- **Randomness**: Mulberry32 PRNG seeded by TXID for consistency
- **Format**: Standard PNG export with metadata JSON

## 📋 Requirements

- **Browser**: Modern web browser with JavaScript enabled
- **Optional**: Local server for full functionality (Python/Node.js/PHP)
- **For Stamping**: Bitcoin wallet and small transaction fee

## 🤝 Contributing

Found a bug or have an idea? Feel free to open an issue or submit a pull request!

## 📄 License

See LICENSE file for details.
