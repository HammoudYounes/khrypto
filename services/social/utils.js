const swearWords = [
    // English (expanded)
    'fuck', 'fucker', 'fucking', 'motherfucker', 'mf', 'stfu',
    'shit', 'bullshit', 'horseshit', 'dogshit', 'shitty', 'shite',
    'ass', 'asshole', 'arsehole', 'asshat', 'asswipe', 'dumbass', 'jackass', 'smartass',
    'bitch', 'bastard', 'cunt', 'dick', 'dickhead', 'dipshit', 'shithead',
    'piss', 'pissed', 'pisshead', 'damn', 'goddamn', 'crap',
    'whore', 'slut', 'skank', 'ho', 'hoe',
    'prick', 'wank', 'wanker', 'tosser', 'twat', 'bollocks',
    'bugger', 'bloody', 'bloodyhell',
    'cock', 'cocksucker', 'cum', 'cumshot',
    'pussy', 'tits', 'tit', 'boobs', 'boob',
    'moron', 'idiot', 'imbecile', 'retard',
    'douche', 'douchebag', 'scumbag', 'loser',
    'jerk', 'jerkoff', 'nutjob', 'weirdo',

    // French (expanded slang + variants)
    'putain', 'merde', 'bordel', 'putaincon',
    'con', 'conne', 'connard', 'connasse',
    'salope', 'salopard', 'salaud',
    'bite', 'cul', 'trouduc', 'trou-du-cul', 'fion',
    'pute', 'pouffiasse',
    'encule', 'enculé', 'enculée', 'enculer',
    'batard', 'bâtard',
    'couille', 'couilles', 'cassecouille', 'casse-couilles',
    'chier', 'faitchier',
    'niquer', 'nique', 'niqué', 'niquerai',
    'baiser', 'baise', 'baisé',
    'fdp', 'tg', 'ta gueule',
    'va te faire foutre', 'va-te-faire-foutre',
    'chienne', 'garce',
    'gouine', 'pede', 'pédé', 'tapette',
    'raclure', 'taré', 'débile',
    'clochard', 'branleur', 'branleuse',
    'gland', 'glandeur',
    'abruti', 'crétin', 'conard', // common misspells

    // Verlan / slang / street variants (France)
    'teubé', 'keuf', 'relou', 'chelou',
    'boloss', 'blédard', 'kéké',
    'zebi', 'zob', 'zobbi',
    'bz', 'bzr', // "baiser" abbreviations
    'ntm', // nique ta mère
    'nique ta mère', 'nique ta race',

    // Mild but often filtered (depending on strictness)
    'dammit', 'hell', 'wtf', 'omfg',
];

const swearPattern = new RegExp(`\\b(${swearWords.join('|')})\\b`, 'gi');

function filterSwearWords(text) {
    return text.replace(swearPattern, match => '*'.repeat(match.length));
}

module.exports = { filterSwearWords };
