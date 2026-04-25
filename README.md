# KairoClaw 

Welcome to **KairoClaw**! A highly contextual, proactive AI assistant designed to act as your personal companion and automation engine. Built as a monorepo, KairoClaw integrates multiple services such as Telegram, Google Workspace, OpenRouter, and more.

## 🌟 Features
- **Multi-LLM Routing**: Primary support for **Gemma 4** (via OpenRouter), with an optimized priority queue including **Nemotron**, **Kimi**, and **Minimax**, plus **Gemini Flash** as a robust fallback.
- **Proactive Context**: High situational awareness injecting daily active tasks, recent completions, and last 3 days of journal entries. Automated morning, midday, and evening cron checks (powered by Luxon).
- **Integrations**: 
  - **Telegram Bot**: Seamless messaging interface.
  - **Google Workspace**: Proactive email reading, searching, drafting, and calendar management (via `gog` CLI).
  - **Weather**: Real-time Monterrey weather integration via Open-Meteo API.
- **Task & Chat Management**: Smart tracking of pending tasks to avoid duplicated effort, coupled with natural social conversation support.
- **Web Interface**: Premium mobile-responsive React (Vite) UI featuring structured sidebar navigation, Daily Journals, Task tracking, Finance ("Gastos"), and Gym muscle group tracking.
- **Robust Database**: MongoDB integration with automatic Monterrey timezone (`America/Monterrey`) timestamp management and daily log merging.

## 🚀 Getting Started

### Prerequisites
- Node.js >= 20.9.0
- Docker & Docker Compose (optional, for DB & deployments)
- MongoDB instance

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Rogerhrg/KairoClaw.git
   cd KairoClaw
   ```

2. Install dependencies (Workspace):
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   Copy `.env.example` to `.env` and fill in your corresponding API keys:
   ```bash
   cp .env.example .env
   ```

4. Run the Development Server:
   ```bash
   npm run dev
   ```

## 🏗️ Structure
KairoClaw uses a monorepo setup:
- `apps/` - Contains the primary React (Vite) web application and the backend Fastify API routes.
- `packages/` - Shared services, context logic, database abstractions, and third-party integrations.

## 🛠️ Stack
- **Frontend**: React (Vite), TypeScript.
- **Backend**: Node.js, Fastify, MongoDB (Native Driver).

## 🔑 Google Workspace Integration Setup

To allow Kairo to read your emails and calendar, KairoClaw uses the `gog` CLI tool. Follow these steps carefully to authenticate without exposing sensitive data:

1. **Google Cloud Console**:
   - Create a project and enable the **Gmail API** and **Google Calendar API**.
   - Set up your **OAuth consent screen** (add your email as a Test User).
   - Create **OAuth 2.0 Client IDs** (Type: Web application or Desktop app) and add `http://127.0.0.1:8080/oauth2/callback` as an Authorized redirect URI.
   - Download the `credentials.json` file.
   - Copy the Client ID and Client Secret into your `.env` file (see `.env.example`).

2. **Server Authentication (First time only)**:
   Place your `credentials.json` inside the `bin/` folder in your server/local environment, then run the following inside your container/terminal:
   ```bash
   # 1. Register the credentials file in gogcli
   ./bin/gog_linux auth credentials set bin/credentials.json

   # 2. Start the auth flow for your email (using non-interactive keyring)
   GOG_KEYRING_BACKEND=file ./bin/gog_linux auth add your_email@gmail.com --services gmail,calendar --remote --redirect-uri http://127.0.0.1:8080/oauth2/callback --force-consent
   ```
3. **Finish Auth**:
   Open the generated URL in your browser, accept the permissions, and copy the full redirect URL (it will look like `http://127.0.0.1:8080/oauth2/callback?...`). Then run step 2:
   ```bash
   GOG_KEYRING_BACKEND=file ./bin/gog_linux auth add your_email@gmail.com --services gmail,calendar --remote --step 2 --redirect-uri http://127.0.0.1:8080/oauth2/callback --auth-url "PASTE_THE_COPIED_URL_HERE"
   ```
   *(Ensure you persist the `/root/.config/gogcli` volume in your Docker setup so you don't have to repeat this on every deployment!)*

## 📝 License
This project is private and maintained by [Rogerhrg](https://github.com/Rogerhrg).
