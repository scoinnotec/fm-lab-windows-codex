# FileMaker Object Browser - Web Client

Ein einfacher Web-Client zum Durchsuchen von FileMaker-Objekten über die REST-API.

## Features

- **Suchfeld**: Suche nach Objektnamen (Teilstring-Suche)
- **Objekttyp-Filter**: Dropdown mit allen verfügbaren Objekttypen
- **Ergebnisliste**: Übersichtliche Darstellung der gefundenen Objekte

## Voraussetzungen

- Node.js >= 18.0.0
- REST-API läuft auf `http://localhost:3003`
- `packages/shared` ist gebaut

## Installation

```bash
# Im Projekt-Root
npm install

# Shared package bauen (falls noch nicht geschehen)
cd packages/shared
npm run build
```

## Development

```bash
# Terminal 1: REST-API starten (falls nicht schon läuft)
cd rest-api
npm run dev

# Terminal 2: Web-Client starten
cd apps/web
npm run dev
```

Der Web-Client öffnet sich automatisch auf http://localhost:5173

## Verwendung

1. Geben Sie einen Suchbegriff ein (z.B. "Import", "User", "Email")
2. Optional: Wählen Sie einen Objekttyp aus dem Dropdown
3. Klicken Sie auf "Suchen"
4. Die Ergebnisse werden unterhalb angezeigt

## Struktur

```
apps/web/
├── src/
│   ├── api/
│   │   └── client.ts       # API-Client Instanz
│   ├── App.tsx             # Hauptkomponente mit Such-UI
│   ├── App.css             # Styles
│   ├── main.tsx            # Entry Point
│   └── index.css           # Globale Styles
├── .env                    # API-URL Konfiguration
├── package.json
└── vite.config.ts
```

## Umgebungsvariablen

`.env` Datei:
```bash
VITE_API_URL=http://localhost:3003
```

## Build

```bash
npm run build
```

Build-Output wird in `dist/` erstellt.

## Nächste Schritte

- Detail-Ansicht für einzelne Objekte
- Referenz-Navigation (Parent/Child)
- Erweiterte Filter
- Syntax-Highlighting für Script-Code
- Export-Funktionen
