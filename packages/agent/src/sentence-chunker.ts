/**
 * Découpe un flux de deltas texte (SSE) en phrases prêtes à vocaliser.
 * Port du pattern `chunker.py` d'Alfred : on n'envoie au TTS que des phrases
 * complètes — la première phrase part dès qu'elle est finie, sans attendre la
 * fin de la réponse.
 *
 * Contrat de durée de vie : une instance = UN tour vocal ; ne pas réutiliser
 * entre tours (l'état buffer/settled est conservé d'un push à l'autre).
 *
 * Invariants :
 *  - une « phrase » se termine par . ! ? … ou un saut de ligne, suivis
 *    d'éventuels marqueurs markdown de fermeture collés dessus (**, *, `),
 *    puis d'un blanc ;
 *  - un « . » précédé d'une abréviation connue (M., p., etc.) n'est PAS une
 *    frontière de phrase — on continue à chercher la suivante. Ne s'applique
 *    jamais à ! ? … ni au saut de ligne ;
 *  - le tout premier fragment émis, s'il fait moins de MIN_CHARS, est retenu
 *    et fusionné avec la phrase suivante — ça évite un aller-retour réseau
 *    TTS dédié pour un « Ok. » isolé en ouverture de réponse. Une fois la
 *    première phrase réellement émise, les fragments courts suivants (ex.
 *    « Voilà. » en fin d'énumération) partent tels quels : les retenir sans
 *    fin connue casserait le flux ;
 *  - au-delà de MAX_CHARS sans délimiteur, on coupe au dernier espace (évite
 *    de dépasser la limite de la route /speak sur une énumération sans
 *    point) ; une coupe qui ne produit que du blanc n'émet rien ;
 *  - le markdown de mise en forme (gras, italique, code, puces) est retiré —
 *    il n'a aucun sens à l'oral.
 */

const MIN_CHARS = 8;
const MAX_CHARS = 300;

/**
 * Délimiteur de phrase : ponctuation finale, marqueurs markdown de fermeture
 * éventuellement collés dessus (**gras**, *italique*, `code`), puis un blanc.
 *
 * Volontairement NON global : `exec` doit repartir du début de la fenêtre à
 * chaque itération, le buffer étant muté après chaque découpe — un flag /g
 * conserverait un `lastIndex` obsolète et serait ici le bug. Le saut des
 * frontières non retenues (abréviations) passe par la fenêtre de scan
 * explicite `searchFrom` dans `push()`, pas par l'état du regex.
 */
const BOUNDARY = /([.!?…\n])([*_`]*)(\s+)/;

/**
 * Abréviations dont le « . » ne termine pas une phrase. Sensibles à la casse,
 * comparées au mot situé entre le dernier blanc (ou le début du buffer) et le
 * délimiteur. Ne concerne que « . » — jamais ! ? … ni le saut de ligne.
 */
const NON_BREAKING_ABBREVIATIONS = new Set([
  'M',
  'Mme',
  'Mlle',
  'Dr',
  'St',
  'Ste',
  'cf',
  'ex',
  'etc',
  'n°',
  'p',
  'art',
  'Mr',
  'Mrs',
  'Ms',
  'vs',
]);

/** Retire la mise en forme markdown inutile à l'oral (gras/italique/code/puces). */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(^|\s)[-•]\s+/g, '$1');
}

export class SentenceChunker {
  private buffer = '';
  /** Premier fragment (< MIN_CHARS) retenu en attendant la phrase suivante. */
  private held = '';
  /** true dès qu'une première phrase a réellement été émise. */
  private settled = false;

  /** Ajoute un delta ; renvoie les phrases complètes détectées (0..n). */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    // Fenêtre de scan : avance au-delà des frontières ignorées (abréviations)
    // sans muter le buffer ; remise à 0 après chaque découpe effective.
    let searchFrom = 0;

    for (;;) {
      const match = BOUNDARY.exec(this.buffer.slice(searchFrom));
      if (match === null) break;

      // Les 3 groupes de BOUNDARY participent toujours à un match réussi (aucun
      // n'est dans une alternation) : ils sont toujours définis, au pire ''.
      // Un garde (`??`, `if (... === undefined)`) introduirait une branche
      // jamais atteignable à l'exécution (échec de la couverture 100%) ; on
      // documente la garantie par une assertion de type plutôt que par un
      // contrôle mort.
      const delim = match[1] as string;
      const closers = match[2] as string;
      const whitespace = match[3] as string;
      const delimIndex = searchFrom + match.index;

      if (delim === '.') {
        // Mot précédant le point. `split(/\s/)` renvoie toujours au moins un
        // élément ([''] sur une chaîne vide) : `pop()` ne peut pas rendre
        // undefined, l'assertion évite un garde mort (même logique que pour
        // les groupes ci-dessus).
        const token = this.buffer.slice(0, delimIndex).split(/\s/).pop() as string;
        if (NON_BREAKING_ABBREVIATIONS.has(token)) {
          // Abréviation : pas une fin de phrase — on scanne après ce point.
          searchFrom = delimIndex + delim.length + closers.length + whitespace.length;
          continue;
        }
      }

      const rawEnd = delimIndex + delim.length + closers.length;
      const raw = this.buffer.slice(0, rawEnd);
      this.buffer = this.buffer.slice(rawEnd + whitespace.length);
      searchFrom = 0;
      const sentence = stripMarkdown(raw).trim();
      // Frontière sans contenu (ex. sauts de ligne consécutifs) : rien à
      // vocaliser — le buffer est déjà consommé, `held`/`settled` inchangés.
      if (sentence === '') continue;

      if (this.held !== '') {
        out.push(`${this.held} ${sentence}`);
        this.held = '';
        this.settled = true;
      } else if (!this.settled && raw.length < MIN_CHARS) {
        this.held = sentence;
      } else {
        this.settled = true;
        out.push(sentence);
      }
    }

    // Garde-fou : buffer interminable sans délimiteur → coupe au dernier espace.
    while (this.buffer.length > MAX_CHARS) {
      const cut = this.buffer.lastIndexOf(' ', MAX_CHARS);
      const at = cut > 0 ? cut : MAX_CHARS;
      const sentence = stripMarkdown(this.buffer.slice(0, at)).trim();
      this.buffer = this.buffer.slice(at + (cut > 0 ? 1 : 0));
      if (sentence !== '') {
        out.push(sentence);
        this.settled = true;
      }
    }

    return out;
  }

  /** Renvoie le reliquat (fin de réponse sans délimiteur, ou fragment retenu) et vide le buffer. */
  flush(): string {
    const rest = this.held !== '' ? `${this.held} ${this.buffer}` : this.buffer;
    this.buffer = '';
    this.held = '';
    return stripMarkdown(rest).trim();
  }
}
