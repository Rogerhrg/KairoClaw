# KairoClaw 🐾

Welcome to **KairoClaw**! A highly contextual, proactive AI assistant designed to act as your personal companion and automation engine. Built as a monorepo, KairoClaw integrates multiple services such as Telegram, Google Workspace, OpenRouter, and more.

## 🌟 Features
- **Multi-LLM Routing**: Support for Gemini, Nemotron, Kimi, and Minimax through OpenRouter and NVIDIA integration.
- **Proactive Context**: Daily journal entries and automated morning/evening cron checks (powered by Luxon).
- **Integrations**: Telegram Bot, Google Calendar, Gmail CLI, Open-Meteo API.
- **Task Management**: Smart tracking of pending tasks and completions to avoid duplicated effort.
- **Web Interface**: Next.js UI for managing data, journals, and interacting with Kairo.
- **Robust Database**: MongoDB integration with automatic Monterrey timezone (`America/Monterrey`) timestamp management.

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
- `apps/` - Contains the primary Next.js web application and the backend API routes.
- `packages/` - Shared services, context logic, database abstractions, and third-party integrations.

## 🛠️ Stack
- **Frontend**: Next.js (React), TypeScript.
- **Backend**: Node.js, Express/Next.js API Routes, Mongoose.

## 📝 License
This project is private and maintained by [Rogerhrg](https://github.com/Rogerhrg).
