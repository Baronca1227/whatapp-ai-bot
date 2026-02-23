const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("🤖 Bot is alive!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const P = require("pino");
const fetch = require("node-fetch");

// Track your activity to know if you are "online"
let lastUserActivity = 0;
const TEN_MINUTES = 10 * 60 * 1000;

// Function to send message to Hugging Face AI
async function smartReply(text) {
    try {
        const response = await fetch(
            "https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.HF_TOKEN}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ inputs: text })
            }
        );

        const data = await response.json();

        if (Array.isArray(data) && data[0]?.generated_text) {
            return data[0].generated_text.replace(text, "").trim();
        }

        return "🤖 I got your message!";
    } catch {
        return "🤖 AI unavailable.";
    }
}

// Start WhatsApp bot
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    const sock = makeWASocket({
        logger: P({ level: "silent" }),
        auth: state,
        browser: ["Baron AI", "Chrome", "1.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text;

        if (!text) return;

        // If YOU send a message → reset activity timer
        if (msg.key.fromMe) {
            lastUserActivity = Date.now();
            return;
        }

        // Ignore group messages
        if (sender.includes("@g.us")) return;

        const now = Date.now();
        const timeSinceActive = now - lastUserActivity;

        // Wait 10 min if online
        if (timeSinceActive < TEN_MINUTES) {
            setTimeout(async () => {
                const aiReply = await smartReply(text);
                await sock.sendMessage(sender, { text: aiReply });
            }, TEN_MINUTES);
        } else {
            // Reply instantly if offline
            const aiReply = await smartReply(text);
            await sock.sendMessage(sender, { text: aiReply });
        }
    });

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                console.log("🔄 Reconnecting...");
                startBot();
            }
        } else if (connection === "open") {
            console.log("✅ Bot Connected");
        }
    });
}

startBot();
