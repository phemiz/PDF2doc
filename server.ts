import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from 'module';
import Stripe from 'stripe';
import { google } from 'googleapis';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let stripeClient: Stripe | null = null;
export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // API Routes
  app.post("/api/extract-text", async (req, res) => {
    console.log("Received request for /api/extract-text");
    try {
      const { base64Data } = req.body;
      if (!base64Data) {
        console.error("No base64Data provided");
        return res.status(400).json({ success: false, error: "No base64Data provided" });
      }
      
      console.log(`Processing buffer of size: ${(base64Data.length / 1024 / 1024).toFixed(2)} MB`);
      const buffer = Buffer.from(base64Data, 'base64');
      
      if (buffer.length === 0) {
        throw new Error("Empty file buffer received.");
      }

      // Check for PDF magic number %PDF-
      if (buffer.toString('utf8', 0, 4) !== '%PDF') {
        console.warn("File does not start with %PDF header. Attempting extraction anyway.");
      }
      
      // Add timeout protection for large PDFs - increased to 90s
      const data = await Promise.race([
        pdf(buffer),
        new Promise((_, reject) => setTimeout(() => reject(new Error('PDF extraction timed out (90s). The file might be too large, complex, or password-protected.')), 90000))
      ]) as any;
      
      console.log(`Extraction successful. Pages: ${data.numpages}`);
      res.json({ 
        success: true, 
        text: data.text,
        info: data.info,
        numpages: data.numpages
      });
    } catch (error: any) {
      console.error("Extraction error:", error);
      const status = error.message.includes('timed out') ? 504 : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  });

  app.post("/api/convert", async (req, res) => {
    res.json({ success: true, message: "Server ready for heavy processing" });
  });

  app.post("/api/create-checkout-session", async (req, res) => {
    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'PDF2doc Pro',
                description: 'Unlock batch processing and cloud sync',
              },
              unit_amount: 999, // $9.99
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${process.env.APP_URL || req.headers.origin}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL || req.headers.origin}/?canceled=true`,
      });
      res.json({ id: session.id, url: session.url });
    } catch (error: any) {
      console.error("Stripe error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Google Drive OAuth
  function getGoogleOAuthClient(req: express.Request) {
    const redirectUri = `${process.env.APP_URL || req.headers.origin}/api/auth/google/callback`;
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  }

  app.get('/api/auth/google/url', (req, res) => {
    try {
      const oauth2Client = getGoogleOAuthClient(req);
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive.file'],
      });
      res.json({ url });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      const { code } = req.query;
      const oauth2Client = getGoogleOAuthClient(req);
      const { tokens } = await oauth2Client.getToken(code as string);
      
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      res.status(500).send(`Authentication failed: ${error.message}`);
    }
  });

  app.post('/api/drive/upload', async (req, res) => {
    try {
      const { tokens, fileName, mimeType, base64Data } = req.body;
      if (!tokens || !fileName || !base64Data) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials(tokens);

      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      const buffer = Buffer.from(base64Data, 'base64');

      const fileMetadata = {
        name: fileName,
      };
      const media = {
        mimeType: mimeType || 'application/octet-stream',
        body: require('stream').Readable.from(buffer),
      };

      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink',
      });

      res.json({ success: true, fileId: file.data.id, link: file.data.webViewLink });
    } catch (error: any) {
      console.error('Drive upload error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
