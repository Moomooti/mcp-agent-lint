import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

// Plain JS so the stdio fixture can run under `node` with no build step.
// Two servers: one that follows every rule, and one modeled on a real bug -
// an MCP game server that returned base64 images inline and broke the host's answer generation.

const roomParams = {
  room_code: { type: 'string', description: 'Room code shared by the players in one game.' },
  nickname: { type: 'string', description: "The caller's nickname in the room." },
};

export const goodTools = [
  {
    name: 'check_status',
    description: "Shows the caller's toilet level, poop stack and coin balance in the given room. Read-only.",
    inputSchema: { type: 'object', properties: roomParams, required: ['room_code', 'nickname'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'throw_poop',
    description: 'Throws a random poop at another player in the room and returns what happened, with an image URL.',
    inputSchema: {
      type: 'object',
      properties: { ...roomParams, target: { type: 'string', description: 'Nickname of the player to hit.' } },
      required: ['room_code', 'nickname'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'reset_room',
    description: 'Deletes every player and score in the room. Cannot be undone; ask the user before calling.',
    inputSchema: { type: 'object', properties: { room_code: roomParams.room_code }, required: ['room_code'] },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

export const badTools = [
  {
    name: 'throw poop!',
    description: 'Throws poop.',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string' },
        options: {
          type: 'object',
          properties: { target: { type: 'string' }, power: { type: 'number', description: 'How hard, 1-10.' } },
        },
        tags: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } },
      },
    },
  },
  {
    name: 'getStatus',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false },
  },
];

// 1x1 JPEG repeated so the payload looks like a real (large) inline image.
const FAKE_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA'.repeat(40);

export function callTool(name, args, { variant, baseUrl = 'https://example.test' }) {
  const text = (t) => ({ content: [{ type: 'text', text: t }] });
  if (variant === 'good') {
    if (name === 'check_status') return text(`🚽 Lv.0 · stack 0/10 · coins 500\n🖼️ ${baseUrl}/assets/base.jpg`);
    if (name === 'throw_poop') {
      if (!args.room_code) return { isError: true, content: [{ type: 'text', text: 'room_code is required' }] };
      // Some servers reject bad input at the protocol level instead of returning isError.
      if (args.target === '__protocol_error__') throw new McpError(ErrorCode.InvalidParams, 'target must be a nickname');
      return text(`💩 Hit ${args.target ?? 'nobody'}!\n🖼️ ${baseUrl}/assets/species/1.jpg`);
    }
    if (name === 'reset_room') return text('Room reset.');
  }
  if (variant === 'bad') {
    if (name === 'throw poop!') {
      return {
        content: [
          { type: 'text', text: '💩 Hit!' },
          { type: 'image', data: FAKE_JPEG_BASE64, mimeType: 'image/jpeg' },
        ],
      };
    }
    if (name === 'getStatus') return { content: [{ type: 'text', text: 'x'.repeat(6000) }] };
  }
  return { isError: true, content: [{ type: 'text', text: `Unknown tool ${name}` }] };
}
