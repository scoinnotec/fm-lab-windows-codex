const express = require('express');
const router = express.Router({ caseSensitive: false });
const controller = require('../controllers/plugin-docs.controller');

/**
 * Plugin-Docs Routes
 *
 *   GET /api/plugin-docs                       — Liste verfügbarer Quellen
 *   GET /api/plugin-docs/:source               — Status einer Quelle
 *   GET /api/plugin-docs/:source/_categories             — Kategorien-Liste
 *   GET /api/plugin-docs/:source/_categories/:category    — Funktionen einer Kategorie
 *   GET /api/plugin-docs/:source/_search?q=…              — Volltextsuche über Funktionsnamen
 *   GET /api/plugin-docs/:source/:function     — Doku einer Funktion
 *
 * Hinweis zu Punkten im :function-Param: Express akzeptiert Punkte in
 * Pfad-Parametern ohne Encoding ("List.AddPrefix"). Funktionsnamen mit
 * Leerzeichen oder Slashes — derzeit nicht im MBS-Korpus, aber denkbar
 * für andere Quellen — würden URL-Encoding erfordern.
 *
 * Reihenfolge: Die Underscore-Routen (_categories, _search) müssen VOR
 * der generischen :function-Route registriert werden, sonst werden
 * "_categories" und "_search" als Funktionsname interpretiert.
 */

router.get('/plugin-docs', controller.listSources);
router.get('/plugin-docs/:source/_categories/:category', controller.getCategoryFunctions);
router.get('/plugin-docs/:source/_categories', controller.getCategories);
router.get('/plugin-docs/:source/_search', controller.searchFunctions);
router.get('/plugin-docs/:source', controller.getSourceStatus);
router.get('/plugin-docs/:source/:function', controller.getFunctionDoc);

module.exports = router;
