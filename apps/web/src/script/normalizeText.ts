/**
 * Manche Steps liefern ihren Parameter-Block (in eckigen Klammern) als
 * eigene Zeile, getrennt durch \r — z.B. "Commit Records/Requests\r[ No dialog ]".
 * Solche Umbrüche dienen nur der Editor-Formatierung und sollen im Web-Viewer
 * inline gerendert werden. Der Whitespace direkt vor '[' wird auf ein einzelnes
 * Space normalisiert.
 *
 * Echte Multi-line Calcs (mit \r mitten in Argumenten) bleiben davon
 * unberührt, da deren \r typischerweise NICHT direkt vor '[' steht
 * (sondern z.B. nach Semikolon, zwischen Argumenten).
 */
export function collapseStepParameterBreaks(text: string): string {
  return text.replace(/[\r\n]+\s*\[/g, ' [');
}
