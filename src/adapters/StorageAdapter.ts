// adapters/StorageAdapter.ts — 共通インターフェース（ch.05 §5.1）
//
// 同期エンジンが要求するのは 4 操作（list/get/put/delete）だけ。保存先の違いはこの裏に隠す。
// 正しさは list/get/put/delete だけで成立し、putIfAbsent（CAS）は任意の最適化にすぎない。
// 型の単一の真実は model/types.ts。ここはアダプタ層の入口として再公開する。
export type { StorageAdapter } from '../model/types';
