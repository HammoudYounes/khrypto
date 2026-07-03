/**
 * Wager panel (devnet) — lets the two players of an online match escrow a
 * SOL stake via Phantom. Renders nothing unless the escrow service is
 * enabled on this deployment and the game is an online match.
 *
 * Uses the solanaWeb3 IIFE bundle (loaded from CDN in index.html) to
 * deserialize the deposit transaction built by the escrow service.
 */
import { TokenManager, ApiHost } from '../js/tokenManager.js';
import { state } from './gameState.js';

let panel = null;
let pollTimer = null;
let currentGameId = null;

function h(html) {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.firstChild;
}

function authHeaders() {
    return {
        'Authorization': `Bearer ${TokenManager.getAccessToken()}`,
        'Content-Type': 'application/json'
    };
}

async function api(path, opts = {}) {
    const res = await fetch(`${ApiHost.getHost()}${path}`, { headers: authHeaders(), ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
}

function setStatus(msg, color = '#ccc') {
    const el = panel && panel.querySelector('#wagerStatus');
    if (el) { el.textContent = msg; el.style.color = color; }
}

export async function initWagerPanel(gameId) {
    if (state.gameMode !== 'online') return;
    if (sessionStorage.getItem('isGuest') === 'true') return;
    if (!TokenManager.getAccessToken()) return;
    currentGameId = gameId;

    // Only render if escrow is actually configured on this deployment
    const status = await api('/api/escrow/status').catch(() => null);
    if (!status || !status.body.enabled) return;

    panel = h(`
        <div id="wagerPanel" style="position:fixed;bottom:12px;right:12px;z-index:6000;
             background:rgba(10,10,10,0.92);border:1px solid #c9a227;border-radius:10px;
             padding:10px 14px;min-width:230px;font-size:0.9rem;color:#eee;">
            <div style="font-weight:bold;color:#c9a227;margin-bottom:6px;">💰 Wager (devnet SOL)</div>
            <div id="wagerBody"></div>
            <div id="wagerStatus" style="margin-top:6px;font-size:0.8rem;color:#ccc;"></div>
        </div>
    `);
    document.body.appendChild(panel);

    await refresh();
    pollTimer = setInterval(refresh, 6000);
}

export function destroyWagerPanel() {
    if (pollTimer) clearInterval(pollTimer);
    if (panel) panel.remove();
    panel = null;
}

async function refresh() {
    if (!panel) return;
    const { ok, status, body } = await api(`/api/escrow/game/${encodeURIComponent(currentGameId)}`);

    if (!ok && status === 404) return renderPropose();
    if (!ok) return setStatus('Escrow unavailable', '#e74c3c');
    renderEscrow(body);
}

function renderPropose() {
    const bodyEl = panel.querySelector('#wagerBody');
    if (bodyEl.dataset.mode === 'propose') return;
    bodyEl.dataset.mode = 'propose';
    bodyEl.innerHTML = `
        <div style="display:flex;gap:6px;align-items:center;">
            <input id="wagerStake" type="number" min="0.001" step="0.001" value="0.01"
                   style="width:80px;background:#111;color:#eee;border:1px solid #444;border-radius:6px;padding:4px;"> SOL
            <button id="wagerProposeBtn" class="btn btn-gold" style="padding:4px 10px;">Propose</button>
        </div>`;
    setStatus('Both players need a linked wallet.');

    bodyEl.querySelector('#wagerProposeBtn').addEventListener('click', async () => {
        const sol = parseFloat(bodyEl.querySelector('#wagerStake').value);
        if (!(sol > 0)) return setStatus('Enter a valid stake', '#e74c3c');
        setStatus('Creating escrow…');
        const { ok, body } = await api('/api/escrow/wager', {
            method: 'POST',
            body: JSON.stringify({ gameId: currentGameId, stakeLamports: Math.round(sol * 1e9) })
        });
        if (!ok) return setStatus(body.error || 'Failed to create escrow', '#e74c3c');
        setStatus('Escrow created — deposit your stake');
        panel.querySelector('#wagerBody').dataset.mode = '';
        refresh();
    });
}

function renderEscrow(info) {
    const bodyEl = panel.querySelector('#wagerBody');
    const oc = info.onChain;
    const stakeSol = (info.local.stakeLamports / 1e9).toFixed(3);

    if (!oc) return setStatus('Waiting for on-chain state…');

    if (oc.settled) {
        bodyEl.innerHTML = `<div>Stake: <b>${stakeSol} SOL</b> each</div>`;
        return setStatus(`Settled ✓ pot paid to ${oc.winner.slice(0, 4)}…${oc.winner.slice(-4)}`, '#2ecc71');
    }
    if (oc.cancelled) {
        bodyEl.innerHTML = `<div>Stake: <b>${stakeSol} SOL</b> each</div>`;
        return setStatus('Cancelled — stakes refunded', '#f39c12');
    }

    const mySeat = state.myPlayerId;
    const iDeposited = mySeat === 0 ? oc.depositedA : oc.depositedB;
    const oppDeposited = mySeat === 0 ? oc.depositedB : oc.depositedA;

    if (bodyEl.dataset.mode !== 'escrow') {
        bodyEl.dataset.mode = 'escrow';
        bodyEl.innerHTML = `
            <div>Stake: <b>${stakeSol} SOL</b> each</div>
            <button id="wagerDepositBtn" class="btn btn-gold" style="margin-top:6px;padding:4px 10px;">Deposit stake</button>`;
        bodyEl.querySelector('#wagerDepositBtn').addEventListener('click', deposit);
    }

    const btn = bodyEl.querySelector('#wagerDepositBtn');
    if (btn) btn.style.display = iDeposited ? 'none' : '';
    setStatus(
        iDeposited && oppDeposited ? 'Both stakes locked — winner takes the pot!' :
        iDeposited ? 'Waiting for opponent to deposit…' :
        oppDeposited ? 'Opponent deposited — your turn!' : 'Nobody has deposited yet',
        iDeposited && oppDeposited ? '#2ecc71' : '#ccc'
    );
}

async function deposit() {
    const provider = window.solana;
    if (!provider || !provider.isPhantom) return setStatus('Phantom extension not found', '#e74c3c');
    if (typeof solanaWeb3 === 'undefined') return setStatus('Solana web3 library failed to load', '#e74c3c');

    try {
        setStatus('Building transaction…');
        const { ok, body } = await api('/api/escrow/deposit-tx', {
            method: 'POST',
            body: JSON.stringify({ gameId: currentGameId })
        });
        if (!ok) return setStatus(body.error || 'Failed to build deposit', '#e74c3c');

        await provider.connect();
        const tx = solanaWeb3.Transaction.from(Uint8Array.from(atob(body.transaction), c => c.charCodeAt(0)));
        setStatus('Confirm in Phantom…');
        const { signature } = await provider.signAndSendTransaction(tx);
        setStatus(`Deposit sent (${signature.slice(0, 8)}…) — confirming`, '#f1c40f');
        setTimeout(refresh, 4000);
    } catch (e) {
        console.error('Deposit error:', e);
        setStatus(e.code === 4001 ? 'Deposit cancelled' : 'Deposit failed', '#e74c3c');
    }
}
