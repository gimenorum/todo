// core/index.ts — 同期エンジンの公開境界（barrel / ch.02 §2.3）
// 他レイヤ（services/tests）は個別ファイルでなく本 barrel 経由で import する。

export { serializeSnapshot, serializeCommit } from './serialize';
export { hash, verify, IntegrityError } from './hash';
export {
  objKey,
  headKey,
  decodeObject,
  decodeSnapshot,
  decodeCommit,
  tryDecodeCommit,
  type DecodedObject,
} from './objects';
export { deriveHeads, ancestors, lca, compareHash, type CommitMap } from './dag';
export {
  valueEq,
  mergeField,
  mergeSet,
  mergeTodo,
  merge3,
  merge3NoBase,
  resolveNoBase,
  type FieldMergeResult,
  type TodoMergeResult,
  type MergeResult,
} from './merge';
export { syncOnce, publishHead, MissingObjectError, type LocalState } from './sync';
export { keyBetween, keysAfter } from './order';
