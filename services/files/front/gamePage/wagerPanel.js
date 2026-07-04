/**
 * Wager panel (devnet) — shown only for wager-mode matches. The stake is
 * fixed by the tier chosen in matchmaking and the escrow is created
 * automatically at match time; players just deposit via Phantom and watch
 * the settlement status. Plain online games never show this panel.
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
    const res = await fetch(`${ApiHost.getHost()}${path}`, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
}

function setStatus(msg, color = '#ccc') {
    const el = panel && panel.querySelector('#wagerStatus');
    if (el) { el.textContent = msg; el.style.color = color; }
}

export async function initWagerPanel(gameId) {
    const stakeSol = sessionStorage.getItem('wagerStake') || localStorage.getItem('activeWagerStake');
    if (!stakeSol) return; // not a wager match
    if (sessionStorage.getItem('isGuest') === 'true') return;
    if (!TokenManager.getAccessToken()) return;
    currentGameId = gameId;

    panel = h(`
        <div id="wagerPanel" style="position:fixed;bottom:12px;right:12px;z-index:6000;
             background:rgba(10,10,10,0.92);border:1px solid #c9a227;border-radius:10px;
             padding:10px 14px;min-width:230px;font-size:0.9rem;color:#eee;">
            <div style="font-weight:bold;color:#c9a227;margin-bottom:6px;">💰 Wager match — ◎ ${stakeSol} SOL</div>
            <div id="wagerBody"><em>Setting up escrow…</em></div>
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

let gameIsOver = false;

/** Called when the match ends: settlement is imminent, poll faster. */
export function wagerGameOver() {
    if (!panel) return;
    gameIsOver = true;
    setStatus('Match over — settling on-chain (takes ~15s)…', '#f1c40f');
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 3000);
    refresh();
}

async function refresh() {
    if (!panel) return;
    const { ok, status, body } = await api(`/api/escrow/game/${encodeURIComponent(currentGameId)}`);

    if (!ok && status === 404) {
        // Matchmaking creates the escrow asynchronously — usually appears
        // within a few seconds of the match starting
        return setStatus('Waiting for the escrow to be created…', '#f1c40f');
    }
    if (!ok) return setStatus(body.error || 'Escrow unavailable', '#e74c3c');
    renderEscrow(body);
}

function explorerLink(sig) {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function renderEscrow(info) {
    const bodyEl = panel.querySelector('#wagerBody');
    const oc = info.onChain;
    const stakeSol = (info.local.stakeLamports / 1e9).toFixed(3);
    const potSol = (2 * info.local.stakeLamports / 1e9).toFixed(3);

    if (!oc) return setStatus('Waiting for on-chain confirmation…', '#f1c40f');

    if (oc.settled) {
        const iWon = info.local.myWallet && oc.winner === info.local.myWallet;
        const proof = info.local.settleSignature
            ? `<a href="${explorerLink(info.local.settleSignature)}" target="_blank" rel="noopener"
                  style="color:#7ec8ff;font-size:0.8rem;">View payout on Solana Explorer ↗</a>`
            : '';

        // Mirror the result into the victory modal if it's open
        const modalInfo = document.getElementById('gameOverWagerInfo');
        if (modalInfo) {
            modalInfo.innerHTML = iWon
                ? `🏆 <b style="color:#2ecc71;">You won ◎ ${potSol} SOL!</b><br>${proof}`
                : `💰 Opponent took the ◎ ${potSol} SOL pot.<br>${proof}`;
        }
        bodyEl.innerHTML = iWon
            ? `<div style="font-size:1.05rem;">🏆 <b style="color:#2ecc71;">You won ◎ ${potSol} SOL!</b></div>
               <div style="font-size:0.8rem;color:#aaa;margin:4px 0;">Paid to your wallet ${oc.winner.slice(0, 4)}…${oc.winner.slice(-4)}.
               Your balance updated even if Phantom's activity feed doesn't show it.</div>${proof}`
            : `<div>Opponent won the pot (◎ ${potSol} SOL)</div>
               <div style="font-size:0.8rem;color:#aaa;margin:4px 0;">Better luck next match.</div>${proof}`;
        return setStatus('Settled on-chain ✓', '#2ecc71');
    }
    if (oc.cancelled) {
        bodyEl.innerHTML = `<div>Wager cancelled — <b>◎ ${stakeSol}</b> stakes refunded</div>`;
        const modalInfo = document.getElementById('gameOverWagerInfo');
        if (modalInfo) modalInfo.innerHTML = `💰 Wager cancelled — <b style="color:#f39c12;">stakes refunded</b>`;
        return setStatus('Refunded on-chain ✓', '#f39c12');
    }

    const mySeat = state.myPlayerId;
    const iDeposited = mySeat === 0 ? oc.depositedA : oc.depositedB;
    const oppDeposited = mySeat === 0 ? oc.depositedB : oc.depositedA;

    if (bodyEl.dataset.mode !== 'escrow') {
        bodyEl.dataset.mode = 'escrow';
        bodyEl.innerHTML = `
            <div>Stake: <b>${stakeSol} SOL</b> each — winner takes <b>${(2 * stakeSol).toFixed(3)} SOL</b></div>
            <button id="wagerDepositBtn" class="btn btn-gold" style="margin-top:6px;padding:4px 10px;">Deposit stake</button>`;
        bodyEl.querySelector('#wagerDepositBtn').addEventListener('click', deposit);
    }

    const btn = bodyEl.querySelector('#wagerDepositBtn');
    if (btn) btn.style.display = iDeposited ? 'none' : '';
    if (gameIsOver) {
        setStatus('Match over — settling on-chain (takes ~15s)…', '#f1c40f');
    } else {
        setStatus(
            iDeposited && oppDeposited ? 'Both stakes locked — winner takes the pot!' :
            iDeposited ? 'Waiting for opponent to deposit…' :
            oppDeposited ? 'Opponent deposited — your turn!' : 'Deposit your stake to activate the wager',
            iDeposited && oppDeposited ? '#2ecc71' : '#ccc'
        );
    }
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
