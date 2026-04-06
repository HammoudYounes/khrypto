const swearWords = [
    // English
    'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'shitty', 'shite', 
    'ass', 'asshole', 'arsehole', 'asshat', 'asswipe', 'dumbass', 'jackass',
    'bitch', 'bitching', 'bastard', 'cunt', 'dick', 'dickhead', 'piss', 'damn', 'crap', 
    'whore', 'slut', 'prick', 'wank', 'wanker', 'twat', 'bollocks', 'cock', 'cocksucker',
    'faggot', 'fagot', 'pussy', 'cum', 'cumshot', 'dyke', 'dipshit', 
    'nigger', 'nigga', 'tits', 'tit', 'moron', 'retard',
    
    // French (including regional / slang)
    'putain', 'merde', 'connard', 'connasse', 'salope', 'salopard', 'salaud',
    'con', 'conne', 'bite', 'cul', 'trouduc', 'trou-du-cul', 'fion', 'bordel', 
    'pute', 'pouffiasse', 'foutre', 'encule', 'enculé', 'enculée', 'batard', 'bâtard',
    'couille', 'couilles', 'chier', 'niquer', 'nique', 'niquons', 'baiser', 'baise', 
    'fdp', 'tg', 'ta gueule', 'va-te-faire-foutre', 'chienne', 'garce', 'gouine', 
    'pede', 'pédé', 'tapette', 'raclure', 'taré',
    'zabazoubi', 'zabroun', 'zebi', 'zabzoub', 'tahan'
];

const swearPattern = new RegExp(`\\b(${swearWords.join('|')})\\b`, 'gi');

function filterSwearWords(text) {
    return text.replace(swearPattern, match => '*'.repeat(match.length));
}

module.exports = { filterSwearWords };
