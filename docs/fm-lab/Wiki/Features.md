# Features

The current public setup supports the following features:

- **XML Ingestion Pipeline** — for FileMaker XML exports into a DuckDB database using a flexible SQL template system, designed for easy maintenance and updates as FileMaker evolves ♻️

- **Detailed Object Catalog** — a set of detailed tables covering the relevant FileMaker object types, with a universal catalog linking objects and their dependencies for fast cross-reference queries 🔗

- **Detailed Reference Catalog** — localized tables for all documented FileMaker script steps and functions, providing reference queries and inline help-docs across up to 11 locales 📄

- **DuckDB Backend** — In-process analytical database engine for fast and flexible queries without server setup, often delivering results in milliseconds, even for large solutions 🚀

- **REST API** — Express server providing HTTP access to the analysis database, enabling integration with external tools and services 🧩

- **Web Client** — React/Vite frontend for interactive exploration of the solution's structure and dependencies with rich visualizations 🔎

- **Claude Skills** — Slash commands for conversion, analysis, and documentation installation, designed for seamless use within the Claude Code environment 🤖

- **Comprehensive Docs** — Easy-to-install documentation of FileMaker Pro and MBS plugin functions 📚

- **Plugin System** — Open architecture for adding new tools and integrations, starting with **[fmIDE](https://github.com/fmIDE/fmIDE)** as a first-class citizen to provide direct navigation into FileMaker's Script Workspace 🛠️

- **Prepared for AI code generation** — The architecture and data model are designed to support AI-driven code generation, augmented by reliable context from the object catalog and the integrated docs 🧠