// Lazy-loadable shim around the room data. Rooms stay pure JSON; this module only exists so the
// registry can code-split rooms with a plain dynamic import that works in Node and Vite alike.
import data from './boardroom.json' with { type: 'json' };

export default data;
