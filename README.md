# Croquet? OK!

A club management web app for croquet clubs — built with React and Vite.

## Features

- **Event management** — create and track scheduled, active, and completed events across multiple formats (Golf Croquet, Association, Swiss, Round Robin, and more)
- **Draw generation** — automated match scheduling with support for play days, block play, and elimination brackets
- **Scorecards** — generate and export PDF scorecards with QR codes for easy sharing
- **Club directory** — built-in database of Australian clubs
- **Authentication** — sign-in via [Clerk](https://clerk.com)

## Getting started

```bash
npm install
npm run dev
```

Copy `.env.local.example` to `.env.local` and add your Clerk publishable key before running.

## Tech stack

- [React 18](https://react.dev)
- [Vite 5](https://vitejs.dev)
- [Clerk](https://clerk.com) — authentication
- [jsPDF](https://github.com/parallax/jsPDF) + [html2canvas](https://html2canvas.hertzen.com) — PDF export
- [QRCode](https://github.com/soldair/node-qrcode) — QR code generation
