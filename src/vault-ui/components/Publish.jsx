// Publish panel: what will change, what is skipped and why, and an honest result.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { api } from '../api.js';
import { ui, publishInfo, publishSteps, navigate, itemPath, flushAll, loadState, refreshPublish } from '../store.js';
import { Modal } from './ui.jsx';
import { TYPES } from '../meta.js';

const CHANGE_LABEL = { added: 'New on the site', updated: 'Updated', removed: 'Removed from the site' };

const SITE_JUMP = { site: '/site', resumes: '/resumes' };

function Group({ kind, rows, jump }) {
    if (!rows.length) return null;
    return (
        <div class="pub-group">
            <h3>{CHANGE_LABEL[kind]} <span class="count-chip">{rows.length}</span></h3>
            <ul>
                {rows.map(r => (
                    <li>
                        <span class={'chg chg-' + kind} aria-hidden="true">{kind === 'added' ? '+' : kind === 'removed' ? '−' : '~'}</span>
                        {kind === 'removed'
                            ? <span>{r.title || r.id}</span>
                            : SITE_JUMP[r.type]
                                ? <button type="button" class="link-btn" onClick={() => { jump(null, null, SITE_JUMP[r.type]); }}>{r.title || r.id}</button>
                                : <button type="button" class="link-btn" onClick={() => jump(r.type, r.id)}>{r.title || r.id}</button>}
                        <span class="muted">{r.summary || TYPES[r.type]?.one || ''}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function PublishPanel() {
    const onClose = () => { ui.publish.value = false; };
    const [info, setInfo] = useState(publishInfo.value);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [live, setLive] = useState('');
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [deploy, setDeploy] = useState(null);

    useEffect(() => {
        flushAll();
        setTimeout(async () => {
            try {
                const p = await api.get('/api/publish/preview');
                setInfo(p);
                publishInfo.value = p;
                setMessage(m => m || defaultMessage(p));
            } catch (e) { setError(e.message); }
        }, 200);
        api.get('/api/deploy').then(setDeploy, () => setDeploy({ available: false }));
    }, []);

    const jump = (type, id, path) => { onClose(); navigate(path ?? itemPath(type, id)); };
    const changes = info?.changes ?? [];
    const by = k => changes.filter(c => c.change === k);
    const onMain = info?.branch === 'main';
    const needsWord = onMain && live.trim().toLowerCase() !== 'live';
    const nothing = info && changes.length === 0;

    const publish = async () => {
        setRunning(true);
        setError('');
        publishSteps.value = [];
        try {
            const res = await api.post('/api/publish', { message: message.trim() || defaultMessage(info), ...(onMain ? { confirmLive: true } : {}) });
            setResult(res);
            await loadState();
            refreshPublish(0);
        } catch (e) {
            setError(e.message);
        } finally {
            setRunning(false);
        }
    };

    const steps = result?.steps ?? publishSteps.value;

    return (
        <Modal title="Publish" onClose={onClose} width={680} labelledBy="pub-title">
            <div class="modal-body publish">
                <div class="modal-head">
                    <h2 class="modal-title" id="pub-title">Publish</h2>
                    <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button>
                </div>

                {!info && !error && <p class="muted" role="status">Checking what changed…</p>}
                {error && <p class="error-text" role="alert">{error}</p>}

                {info && !result && (
                    <>
                        <p class={'dest ' + (onMain ? 'live' : 'draft')}>
                            <Icon name={onMain ? 'globe' : 'lock'} size={15} />
                            {onMain
                                ? <span><strong>This publishes to the live site.</strong> Everyone with the link will see it.</span>
                                : <span><strong>Saves to the {info.branch} branch.</strong> Not live. The live site deploys from main.</span>}
                        </p>

                        {nothing && <p class="muted">Nothing has changed since the last publish.</p>}
                        <Group kind="added" rows={by('added')} jump={jump} />
                        <Group kind="updated" rows={by('updated')} jump={jump} />
                        <Group kind="removed" rows={by('removed')} jump={jump} />

                        {(info.skipped?.length ?? 0) > 0 && (
                            <div class="pub-group skipped">
                                <h3>Skipped until fixed <span class="count-chip">{info.skipped.length}</span></h3>
                                <ul>
                                    {info.skipped.map(s => (
                                        <li class="skip">
                                            <button type="button" class="link-btn" onClick={() => jump(s.type, s.id)}>{s.title || s.id}</button>
                                            <span class="reason">{(s.errors ?? []).map(e => e.msg ?? e).join(' · ')}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {(info.warnings?.length ?? 0) > 0 && (
                            <details class="pub-warn">
                                <summary>{info.warnings.length} {info.warnings.length === 1 ? 'item has' : 'items have'} suggestions (they won’t block publishing)</summary>
                                <ul class="pub-sug">
                                    {info.warnings.map(w => (
                                        <li>
                                            <button type="button" class="link-btn" onClick={() => jump(w.type, w.id)}>{w.title || w.id}</button>
                                            <span class="muted">{(w.warnings ?? [w]).map(x => x.msg ?? x).join(' · ')}</span>
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        )}

                        <div class="field">
                            <div class="field-head"><label for="pub-msg">Note for the history</label></div>
                            <input id="pub-msg" class="input" data-autofocus type="text" value={message} onInput={e => setMessage(e.currentTarget.value)} />
                        </div>
                        {onMain && (
                            <div class="field">
                                <div class="field-head"><label for="pub-live">Type “live” to confirm</label></div>
                                <input id="pub-live" class="input" type="text" value={live} onInput={e => setLive(e.currentTarget.value)} autocomplete="off" />
                            </div>
                        )}
                        <div class="modal-actions">
                            <span class="muted deploy-line">{deployLine(deploy)}</span>
                            <button type="button" class="btn" onClick={onClose}>Close</button>
                            <button type="button" class="btn primary" disabled={running || nothing || needsWord} onClick={publish}>
                                {running ? 'Publishing…' : onMain ? 'Publish live' : `Save to ${info.branch}`}
                            </button>
                        </div>
                    </>
                )}

                {steps.length > 0 && (
                    <ol class="steps" aria-live="polite">
                        {steps.map(s => (
                            <li class={s.ok === false ? 'bad' : s.ok ? 'good' : ''}>
                                <Icon name={s.ok === false ? 'alert' : 'check'} size={14} /> <span>{s.name}</span>{s.detail && <span class="muted"> {s.detail}</span>}
                            </li>
                        ))}
                    </ol>
                )}

                {result && (
                    <div class={'result ' + (result.deployed ? 'ok' : 'draft')} role="status">
                        <strong>{result.deployed ? 'Published. The live site is deploying.'
                            : `Saved to ${result.branch}. Not live — the live site deploys from main.`}</strong>
                        <div class="modal-actions"><button type="button" class="btn primary" onClick={onClose}>Done</button></div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

function defaultMessage(info) {
    const c = info?.changes ?? [];
    if (!c.length) return 'Update portfolio';
    if (c.length === 1) return `${c[0].change === 'added' ? 'Add' : c[0].change === 'removed' ? 'Remove' : 'Update'} ${c[0].title || c[0].id}`;
    return `Update portfolio (${c.length} changes)`;
}

function deployLine(d) {
    if (!d || d.available === false) return '';
    const status = d.conclusion || d.status;
    return status ? `Last live deploy: ${status}` : '';
}
