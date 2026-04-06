const swearWords = [
    // English
    'fuck', 'shit', 'ass', 'bitch', 'bastard', 'cunt', 'dick',
    'piss', 'damn', 'crap', 'whore', 'slut', 'prick', 'wank',
    'twat', 'bollocks', 'cock', 'motherfucker', 'asshole', 'arsehole',
    // French
    'putain', 'merde', 'connard', 'connasse', 'salope', 'salopard',
    'con', 'conne', 'bite', 'cul', 'bordel', 'pute', 'foutre',
    'encule', 'batard', 'couille', 'couilles', 'chier', 'niquer',
    'nique', 'fdp', 'tg', 'va-te-faire-foutre'
];

const swearPattern = new RegExp(`\\b(${swearWords.join('|')})\\b`, 'gi');

function filterSwearWords(text) {
    return text.replace(swearPattern, match => '*'.repeat(match.length));
}

module.exports = { filterSwearWords };
