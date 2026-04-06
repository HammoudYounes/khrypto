import { TokenManager } from "../js/tokenManager.js";
import { notificationManager } from "../js/notificationManager.js";

const RARITY_COLORS = {
    common:   { color: '#8a8a8a', glow: 'rgba(138, 138, 138, 0.6)' },
    rare:     { color: '#4A90E2', glow: 'rgba(74, 144, 226, 0.6)' },
    mythical: { color: '#9B59B6', glow: 'rgba(155, 89, 182, 0.6)' },
    goat:     { color: '#ffb300', glow: 'rgba(255, 179, 0, 0.7)' },
};

// ── Auth guard ──────────────────────────────────────────────────────────────
async function ensureAuth() {
    let token = TokenManager.getAccessToken();
    if (!token) {
        const ok = await TokenManager.refreshAccessToken();
        if (!ok) { window.location.href = '../index.html'; return null; }
        token = TokenManager.getAccessToken();
    }
    return token;
}

// ── Balance ─────────────────────────────────────────────────────────────────
async function fetchBalance() {
    const token = await ensureAuth();
    if (!token) return;
    try {
        const res = await fetch('/api/market/balance', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        updateBalanceUI(data.coins);
        sessionStorage.setItem('coins', data.coins);
    } catch {
        console.error('Failed to fetch balance');
    }
}

function updateBalanceUI(coins) {
    const el = document.getElementById('coinBalance');
    if (el) el.textContent = coins;
}

// ── Buy lootbox ─────────────────────────────────────────────────────────────
async function buyLootbox() {
    const token = await ensureAuth();
    if (!token) return;

    const buyBtn = document.getElementById('buyBtn');
    const errorMsg = document.getElementById('errorMsg');
    buyBtn.disabled = true;
    errorMsg.style.display = 'none';

    try {
        const res = await fetch('/api/market/buy-lootbox', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (res.status === 402) {
            errorMsg.textContent = `Not enough coins — you need 50 ◆`;
            errorMsg.style.display = 'block';
            buyBtn.disabled = false;
            return;
        }
        if (!res.ok) throw new Error(data.error || 'Purchase failed');

        openModal(data);
        updateBalanceUI(data.newBalance);
        sessionStorage.setItem('coins', data.newBalance);

    } catch (err) {
        errorMsg.textContent = err.message || 'Something went wrong';
        errorMsg.style.display = 'block';
        buyBtn.disabled = false;
    }
}

// ── Modal ───────────────────────────────────────────────────────────────────
function openModal(result) {
    const modal = document.getElementById('lootboxModal');
    const animPhase = document.getElementById('animPhase');
    const resultPhase = document.getElementById('resultPhase');

    // Reset to animation phase
    animPhase.style.display = 'flex';
    resultPhase.style.display = 'none';
    modal.style.display = 'flex';

    const animBox = document.getElementById('animBox');
    const animLid = animBox.querySelector('.anim-lid');
    const particles = document.getElementById('particles');

    // Reset box state
    animBox.classList.remove('shaking');
    animLid.classList.remove('opening');
    particles.innerHTML = '';
    void animBox.offsetWidth; // force reflow

    const rarity = result.item ? result.item.rarity : 'common';

    // Phase 1: shake (600ms)
    animBox.classList.add('shaking');

    setTimeout(() => {
        // Phase 2: lid pops open (400ms)
        animLid.classList.add('opening');
        spawnParticles(particles, rarity);
    }, 600);

    setTimeout(() => {
        // Phase 3: show result
        animPhase.style.display = 'none';
        showResult(result);
        resultPhase.style.display = 'flex';
    }, 1200);
}

function spawnParticles(container, rarity) {
    const { color } = RARITY_COLORS[rarity] || RARITY_COLORS.common;
    const cx = 100; // center of 200px wrap
    const cy = 100;

    for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * 2 * Math.PI;
        const dist = 60 + Math.random() * 60;
        const tx = Math.round(Math.cos(angle) * dist);
        const ty = Math.round(Math.sin(angle) * dist);
        const delay = Math.random() * 0.15;
        const size = 4 + Math.random() * 6;

        const p = document.createElement('div');
        p.className = 'particle';
        p.style.cssText = `
            left: ${cx}px;
            top: ${cy}px;
            width: ${size}px;
            height: ${size}px;
            background: ${color};
            box-shadow: 0 0 6px ${color};
            --tx: ${tx}px;
            --ty: ${ty}px;
            animation-delay: ${delay}s;
        `;
        container.appendChild(p);
    }
}

function showResult(result) {
    const headline = document.getElementById('resultHeadline');
    const img = document.getElementById('resultImg');
    const rarityEl = document.getElementById('resultRarity');
    const nameEl = document.getElementById('resultName');
    const compensationMsg = document.getElementById('compensationMsg');

    const item = result.item;
    const rarity = item ? item.rarity : 'common';
    const { glow } = RARITY_COLORS[rarity] || RARITY_COLORS.common;

    if (result.duplicate) {
        headline.textContent = 'Already owned!';
        compensationMsg.textContent = `+${result.compensation} coins compensation`;
        compensationMsg.style.display = 'block';
    } else {
        const typeLabel = item?.type === 'emote' ? 'New Emote!'
            : item?.type === 'profile_picture' ? 'New Profile Picture!'
            : 'New Item!';
        headline.textContent = typeLabel;
        compensationMsg.style.display = 'none';
    }

    if (item) {
        img.src = `/api/market/${item.assetPath}`;
        img.alt = item.name;
        img.style.boxShadow = `0 0 20px ${glow}`;
        rarityEl.textContent = item.rarity === 'goat' ? '🐐 GOAT' : item.rarity;
        rarityEl.className = `rarity-badge ${item.rarity}`;
        nameEl.textContent = item.name;
    } else {
        img.src = '';
        img.alt = '';
        rarityEl.textContent = '';
        nameEl.textContent = '';
    }
}

function closeModal() {
    document.getElementById('lootboxModal').style.display = 'none';
    document.getElementById('buyBtn').disabled = false;
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const token = await ensureAuth();
    if (!token) return;

    notificationManager.init();
    await fetchBalance();

    document.getElementById('backBtn').addEventListener('click', () => {
        window.location.href = '../homePage/index.html';
    });

    document.getElementById('buyBtn').addEventListener('click', buyLootbox);
    document.getElementById('buyAgainBtn').addEventListener('click', () => {
        closeModal();
        buyLootbox();
    });
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);

    // Close modal on overlay click
    document.getElementById('lootboxModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
});
