function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function renderLinkedText(value) {
  const text = String(value ?? '');
  const parts = [];
  const urlPattern = /https?:\/\/[^\s<>]+/giu;
  let cursor = 0;
  for (const match of text.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const visibleUrl = rawUrl.replace(/[),.!?]+$/u, '');
    const safeUrl = safeHttpUrl(visibleUrl);
    parts.push(escapeHtml(text.slice(cursor, match.index)));
    if (safeUrl) {
      parts.push(`<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(visibleUrl)}</a>`);
      parts.push(escapeHtml(rawUrl.slice(visibleUrl.length)));
    } else {
      parts.push(escapeHtml(rawUrl));
    }
    cursor = match.index + rawUrl.length;
  }
  parts.push(escapeHtml(text.slice(cursor)));
  return parts.join('').replaceAll('\n', '<br>');
}

function renderEmbed(embed) {
  const titleUrl = safeHttpUrl(embed.url);
  const title = embed.title
    ? `<div class="embed-title">${titleUrl
      ? `<a href="${escapeHtml(titleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(embed.title)}</a>`
      : escapeHtml(embed.title)}</div>`
    : '';
  const description = embed.description
    ? `<div class="embed-description">${renderLinkedText(embed.description)}</div>`
    : '';
  const fields = (embed.fields ?? []).map((field) => `
    <div class="embed-field ${field.inline ? 'inline' : ''}">
      <strong>${escapeHtml(field.name)}</strong>
      <div>${renderLinkedText(field.value)}</div>
    </div>`).join('');
  const imageUrl = safeHttpUrl(embed.image?.url ?? embed.thumbnail?.url);
  const image = imageUrl
    ? `<img class="embed-image" src="${escapeHtml(imageUrl)}" alt="Imagem do embed">`
    : '';
  return `<section class="embed">${title}${description}${fields}${image}</section>`;
}

function renderAttachment(attachment) {
  const url = safeHttpUrl(attachment.url);
  if (!url) return '';
  const image = attachment.contentType?.startsWith('image/')
    ? `<img class="attachment-image" src="${escapeHtml(url)}" alt="${escapeHtml(attachment.name)}">`
    : '';
  return `<div class="attachment">${image}<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attachment.name || 'Anexo')}</a> <span>(${Number(attachment.size ?? 0).toLocaleString('pt-BR')} bytes)</span></div>`;
}

function renderMessage(message) {
  const author = message.author?.tag ?? message.author?.username ?? 'Usuário desconhecido';
  const avatar = safeHttpUrl(message.author?.displayAvatarURL?.({ extension: 'png', size: 64 }));
  const avatarHtml = avatar
    ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="">`
    : '<div class="avatar placeholder"></div>';
  const messageUrl = safeHttpUrl(message.url);
  const time = new Date(message.createdAt).toLocaleString('pt-BR', { timeZone: 'UTC' });
  const edited = message.editedAt ? ' · editada (versão anterior indisponível)' : '';
  const content = message.content ? `<div class="message-content">${renderLinkedText(message.content)}</div>` : '';
  const attachments = [...message.attachments.values()].map(renderAttachment).join('');
  const embeds = message.embeds.map(renderEmbed).join('');
  const link = messageUrl
    ? `<a class="message-link" href="${escapeHtml(messageUrl)}" target="_blank" rel="noopener noreferrer">Abrir no Discord</a>`
    : '';
  const body = content || attachments || embeds ? `${content}${attachments}${embeds}` : '<div class="message-content muted">Sem conteúdo textual.</div>';
  return `<article class="message">
    ${avatarHtml}
    <div class="message-main">
      <header><strong>${escapeHtml(author)}</strong><span>${escapeHtml(time)}${edited}</span></header>
      ${body}${link}
    </div>
  </article>`;
}

export async function fetchAllThreadMessages(thread) {
  const collected = [];
  let before;
  while (true) {
    const page = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (page.size === 0) break;
    const messages = [...page.values()];
    collected.push(...messages);
    const oldest = messages.reduce((current, message) => (
      !current || BigInt(message.id) < BigInt(current.id) ? message : current
    ), null);
    if (page.size < 100 || !oldest || oldest.id === before) break;
    before = oldest.id;
  }
  return collected.sort((left, right) => {
    const timeDifference = left.createdTimestamp - right.createdTimestamp;
    if (timeDifference !== 0) return timeDifference;
    return BigInt(left.id) < BigInt(right.id) ? -1 : 1;
  });
}

export function createTranscriptHtml(ticket, messages, resolvedAt, guildId) {
  const renderedMessages = messages.map(renderMessage).join('\n');
  const opened = new Date(ticket.createdAt).toLocaleString('pt-BR', { timeZone: 'UTC' });
  const resolved = new Date(resolvedAt).toLocaleString('pt-BR', { timeZone: 'UTC' });
  const threadLink = ticket.threadId
    ? `https://discord.com/channels/${guildId}/${ticket.threadId}`
    : null;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transcript Ticket #${ticket.ticketId}</title>
<style>
  :root { color-scheme: dark; font-family: Arial, Helvetica, sans-serif; background: #313338; color: #dbdee1; }
  body { margin: 0; padding: 32px 16px; }
  main { max-width: 980px; margin: 0 auto; background: #2b2d31; border-radius: 10px; overflow: hidden; box-shadow: 0 8px 28px #0005; }
  .summary { padding: 24px; background: #232428; border-bottom: 1px solid #3f4147; }
  h1 { margin: 0 0 16px; font-size: 22px; color: #fff; }
  .details { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
  .detail { color: #b5bac1; font-size: 13px; overflow-wrap: anywhere; }
  .detail strong { display: block; margin-bottom: 4px; color: #f2f3f5; }
  .reason { margin-top: 18px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
  .messages { padding: 8px 20px 24px; }
  .message { display: flex; gap: 14px; padding: 16px 4px; border-bottom: 1px solid #3f4147; }
  .avatar { flex: 0 0 40px; width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: #404249; }
  .message-main { min-width: 0; flex: 1; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 6px; }
  header strong { color: #f2f3f5; }
  header span, .muted { color: #949ba4; font-size: 12px; }
  .message-content { line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  a { color: #00a8fc; text-decoration: none; overflow-wrap: anywhere; }
  a:hover { text-decoration: underline; }
  .message-link { display: inline-block; margin-top: 8px; font-size: 12px; }
  .attachment { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin: 8px 0; color: #949ba4; font-size: 12px; }
  .attachment-image, .embed-image { display: block; max-width: min(100%, 560px); max-height: 420px; border-radius: 6px; object-fit: contain; }
  .embed { max-width: 600px; margin-top: 8px; padding: 12px; border-left: 4px solid #5865f2; border-radius: 4px; background: #232428; }
  .embed-title { margin-bottom: 6px; font-weight: 700; }
  .embed-description { white-space: pre-wrap; overflow-wrap: anywhere; }
  .embed-field { margin-top: 8px; }
  .embed-field strong { display: block; margin-bottom: 3px; }
  .embed-image { margin-top: 10px; }
  footer { padding: 14px 24px; color: #949ba4; font-size: 12px; }
</style>
</head>
<body>
<main>
  <section class="summary">
    <h1>Ticket #${ticket.ticketId} — ${escapeHtml(ticket.optionLabel)}</h1>
    <div class="details">
      <div class="detail"><strong>Solicitante</strong>${escapeHtml(ticket.ownerName)} (${escapeHtml(ticket.ownerId)})</div>
      <div class="detail"><strong>Categoria</strong>${escapeHtml(ticket.panelName)} · ${escapeHtml(ticket.optionLabel)}</div>
      <div class="detail"><strong>Atendente responsável</strong>${escapeHtml(ticket.assignedStaffName ?? ticket.assignedStaffId ?? 'Nenhum')}</div>
      <div class="detail"><strong>Aberto em</strong>${escapeHtml(opened)}</div>
      <div class="detail"><strong>Resolvido em</strong>${escapeHtml(resolved)}</div>
      ${threadLink ? `<div class="detail"><strong>Tópico original</strong><a href="${escapeHtml(threadLink)}">Abrir no Discord</a></div>` : ''}
    </div>
    <div class="reason"><strong>Motivo original:</strong><br>${renderLinkedText(ticket.reason)}</div>
  </section>
  <section class="messages">${renderedMessages || '<p class="muted">O tópico não possui mensagens disponíveis.</p>'}</section>
  <footer>Transcript criado pelo Jinx. Edições mostram o conteúdo atualmente disponível; mensagens apagadas e versões antigas não são recuperáveis.</footer>
</main>
</body>
</html>`;
}
