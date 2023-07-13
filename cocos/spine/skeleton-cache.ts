/*
 Copyright (c) 2020-2023 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights to
 use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 of the Software, and to permit persons to whom the Software is furnished to do so,
 subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
*/

import { TrackEntryListeners } from './track-entry-listeners';
import { vfmtPosUvColor4B, vfmtPosUvTwoColor4B, getAttributeStride } from '../2d/renderer/vertex-format';
import { SPINE_WASM } from './lib/instantiated';
import spine from './lib/spine-core.js';
import { SkeletonData } from './skeleton-data';
import { warn } from '../core/platform/debug';

const MaxCacheTime = 30;
const FrameTime = 1 / 60;
const spineTag = SPINE_WASM;
const _useTint = true;
const _byteStrideOneColor = getAttributeStride(vfmtPosUvColor4B);
const _byteStrideTwoColor = getAttributeStride(vfmtPosUvTwoColor4B);

class FrameBoneInfo {
    a = 0;
    b = 0;
    c = 0;
    d = 0;
    worldX = 0;
    worldY = 0;
}

export interface SkeletonCacheItemInfo {
    skeleton: spine.Skeleton;
    clipper: spine.SkeletonClipping;
    state: spine.AnimationState;
    listener: TrackEntryListeners;
    curAnimationCache: AnimationCache | null;
    animationsCache: { [key: string]: AnimationCache };
}

class SpineModel {
    public vCount = 0;
    public iCount = 0;
    public vData: Uint8Array = null!;
    public iData: Uint16Array = null!;
    public meshes: SpineDrawItem[] = [];
}

class SpineDrawItem {
    public iCount = 0;
    public blendMode = 0;
    public textureID = 0;
}

export interface AnimationFrame {
    model: SpineModel;
    boneInfos: FrameBoneInfo[];
}

export class AnimationCache {
    protected _instance: spine.SkeletonInstance = null!;
    protected _state: spine.AnimationState = null!;
    protected _skeletonData: spine.SkeletonData = null!;
    protected _skeleton: spine.Skeleton = null!;
    public _privateMode = false;
    protected _curIndex = -1;
    protected _isCompleted = false;
    protected _maxFrameIdex = 0;
    protected _frameIdx = -1;
    protected _inited = false;
    protected _invalid = true;
    protected _enableCacheAttachedInfo = false;
    protected _skeletonInfo: SkeletonCacheItemInfo | null = null;
    protected _animationName: string | null = null;
    public isCompleted = false;
    public totalTime = 0;
    public frames: AnimationFrame[] = [];

    constructor (data: spine.SkeletonData) {
        this._privateMode = false;
        this._inited = false;
        this._invalid = true;
        this._instance = new spine.SkeletonInstance();
        this._skeletonData = data;
        this._skeleton = this._instance.initSkeleton(data);
        this._instance.setUseTint(_useTint);
    }

    public init (skeletonInfo: SkeletonCacheItemInfo, animationName: string) {
        this._inited = true;
        this._animationName = animationName;
        this._skeletonInfo = skeletonInfo;
    }

    get skeleton () {
        return this._skeleton;
    }

    public setSkin (skinName: string) {
        this._instance.setSkin(skinName);
    }

    public setAnimation (animationName: string) {
        const animations = this._skeletonData.animations;
        let animation: spine.Animation | null = null;
        animations.forEach((element) => {
            if (element.name === animationName) {
                animation = element;
            }
        });
        if (!animation) {
            warn(`find no animation named ${animationName} !!!`);
            return;
        }
        this._maxFrameIdex = Math.floor((animation as any).duration / FrameTime);
        if (this._maxFrameIdex <= 0) this._maxFrameIdex = 1;
        this._instance.setAnimation(0, animationName, false);
    }

    public updateToFrame (frameIdx: number) {
        if (!this._inited) return;
        this.begin();
        if (!this.needToUpdate(frameIdx)) return;
        do {
            // Solid update frame rate 1/60.
            this._frameIdx++;
            this.totalTime += FrameTime;
            this._instance.updateAnimation(FrameTime);
            const model = this._instance.updateRenderData();
            this.updateRenderData(this._frameIdx, model);
            if (this._frameIdx >= this._maxFrameIdex) {
                this.isCompleted = true;
            }
        } while (this.needToUpdate(frameIdx));
    }

    public getFrame (frameIdx: number) {
        const index = frameIdx % this._maxFrameIdex;
        return this.frames[index];
    }

    public invalidAnimationFrames () {
        this._curIndex = -1;
        this._isCompleted = false;
        this.frames.length = 0;
    }

    private updateRenderData (index: number, model: any) {
        const vc = model.vCount;
        const ic = model.iCount;
        const floatStride = (_useTint ?  _byteStrideTwoColor : _byteStrideOneColor) / Float32Array.BYTES_PER_ELEMENT;
        const vUint8Buf = new Uint8Array(Float32Array.BYTES_PER_ELEMENT * floatStride * vc);
        const iUint16Buf = new Uint16Array(ic);

        const vPtr = model.vPtr;
        const vLength = vc * Float32Array.BYTES_PER_ELEMENT * floatStride;
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        const vData = spine.wasmUtil.wasm.HEAPU8.subarray(vPtr, vPtr + vLength);

        vUint8Buf.set(vData);

        const iPtr = model.iPtr;
        const iLength = Uint16Array.BYTES_PER_ELEMENT * ic;
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        const iData = spine.wasmUtil.wasm.HEAPU8.subarray(iPtr, iPtr + iLength);
        const iUint8Buf = new Uint8Array(iUint16Buf.buffer);
        iUint8Buf.set(iData);

        const modelData = new SpineModel();
        modelData.vCount = vc;
        modelData.iCount = ic;
        modelData.vData = vUint8Buf;
        modelData.iData = iUint16Buf;

        const meshes = model.getMeshes();
        const count = meshes.size();
        for (let i = 0; i < count; i++) {
            const mesh = meshes.get(i);
            const meshData = new SpineDrawItem();
            meshData.iCount = mesh.iCount;
            meshData.blendMode = mesh.blendMode;
            meshData.textureID = mesh.textureID;
            modelData.meshes.push(meshData);
        }

        const bones = this._skeleton.bones;
        const boneInfosArray: FrameBoneInfo[] = [];
        bones.forEach((bone) => {
            const boneInfo = new FrameBoneInfo();
            boneInfo.a = bone.a;
            boneInfo.b = bone.b;
            boneInfo.c = bone.c;
            boneInfo.d = bone.d;
            boneInfo.worldX = bone.worldX;
            boneInfo.worldY = bone.worldY;
            boneInfosArray.push(boneInfo);
        });
        this.frames[index] = {
            model: modelData,
            boneInfos: boneInfosArray,
        };
    }

    public begin () {
        if (!this._invalid) return;

        const skeletonInfo = this._skeletonInfo;
        const preAnimationCache = skeletonInfo?.curAnimationCache;

        if (preAnimationCache && preAnimationCache !== this) {
            if (this._privateMode) {
                // Private cache mode just invalid pre animation frame.
                preAnimationCache.invalidAllFrame();
            } else {
                // If pre animation not finished, play it to the end.
                preAnimationCache.updateToFrame(0);
            }
        }
        const listener = skeletonInfo?.listener;
        this._instance.setAnimation(0, this._animationName!, false);
        this.bind(listener!);

        // record cur animation cache
        skeletonInfo!.curAnimationCache = this;
        this._frameIdx = -1;
        this.isCompleted = false;
        this.totalTime = 0;
        this._invalid = false;
    }

    public end () {
        if (!this.needToUpdate()) {
            // clear cur animation cache
            this._skeletonInfo!.curAnimationCache = null;
            this.frames.length = this._frameIdx + 1;
            this.isCompleted = true;
            this.unbind(this._skeletonInfo!.listener);
        }
    }

    public bind (listener: TrackEntryListeners) {
        const completeHandle = (entry: spine.TrackEntry) => {
            if (entry && entry.animation.name === this._animationName) {
                this.isCompleted = true;
            }
        };

        listener.complete = completeHandle;
    }

    public unbind (listener: TrackEntryListeners) {
        (listener as any).complete = null;
    }

    protected needToUpdate (toFrameIdx?: number) {
        return !this.isCompleted
            && this.totalTime < MaxCacheTime
            && (toFrameIdx === undefined || this._frameIdx < toFrameIdx);
    }

    public isInited () {
        return this._inited;
    }

    public isInvalid () {
        return this._invalid;
    }

    public invalidAllFrame () {
        this.isCompleted = false;
        this._invalid = true;
    }

    public enableCacheAttachedInfo () {
        if (!this._enableCacheAttachedInfo) {
            this._enableCacheAttachedInfo = true;
            this.invalidAllFrame();
        }
    }

    // Clear texture quote.
    public clear () {
        this._inited = false;
        this.invalidAllFrame();
    }

    public destory () {
        spine.wasmUtil.destroySpineInstance(this._instance);
    }
}

class SkeletonCache {
    public static readonly FrameTime = FrameTime;
    public static sharedCache = new SkeletonCache();

    protected _privateMode: boolean;
    protected _skeletonCache: { [key: string]: SkeletonCacheItemInfo };
    protected _animationPool: { [key: string]: AnimationCache };
    constructor () {
        this._privateMode = false;
        this._animationPool = {};
        this._skeletonCache = {};
    }

    public enablePrivateMode () {
        this._privateMode = true;
    }

    public clear () {
        this._animationPool = {};
        this._skeletonCache = {};
    }

    public invalidAnimationCache (uuid: string) {
        const skeletonInfo = this._skeletonCache[uuid];
        const skeleton = skeletonInfo && skeletonInfo.skeleton;
        if (!skeleton) return;

        const animationsCache = skeletonInfo.animationsCache;
        for (const aniKey in animationsCache) {
            const animationCache = animationsCache[aniKey];
            animationCache.invalidAllFrame();
        }
    }

    public removeSkeleton (uuid: string) {
        const skeletonInfo = this._skeletonCache[uuid];
        if (!skeletonInfo) return;
        const animationsCache = skeletonInfo.animationsCache;
        for (const aniKey in animationsCache) {
            // Clear cache texture, and put cache into pool.
            // No need to create TypedArray next time.
            const animationCache = animationsCache[aniKey];
            if (!animationCache) continue;
            this._animationPool[`${uuid}#${aniKey}`] = animationCache;
            animationCache.clear();
        }

        delete this._skeletonCache[uuid];
    }

    public getSkeletonCache (uuid: string, skeletonData: spine.SkeletonData) {
        let skeletonInfo = this._skeletonCache[uuid];
        if (!skeletonInfo) {
            const skeleton = new spine.Skeleton(skeletonData);
            const clipper = new spine.SkeletonClipping();
            const stateData = new spine.AnimationStateData(skeleton.data);
            const state = new spine.AnimationState(stateData);
            const listener = new TrackEntryListeners();

            this._skeletonCache[uuid] = skeletonInfo = {
                skeleton,
                clipper,
                state,
                listener,
                // Cache all kinds of animation frame.
                // When skeleton is dispose, clear all animation cache.
                animationsCache: {} as any,
                curAnimationCache: null,
            };
        }
        return skeletonInfo;
    }

    public getAnimationCache (uuid: string, animationName: string) {
        const poolKey = `${uuid}#${animationName}`;
        const animCache = this._animationPool[poolKey];
        return animCache;
    }

    public initAnimationCache (uuid: string, data: SkeletonData,  animationName: string) {
        const spData = data.getRuntimeData();
        if (!spData) return null;
        const skeletonInfo = this._skeletonCache[uuid];
        const skeleton = skeletonInfo && skeletonInfo.skeleton;
        if (!skeleton) return null;
        const animationsCache = skeletonInfo.animationsCache;
        let animationCache = animationsCache[animationName];
        if (!animationCache) {
            // If cache exist in pool, then just use it.
            const poolKey = `${uuid}#${animationName}`;
            animationCache = this._animationPool[poolKey];
            if (animationCache) {
                delete this._animationPool[poolKey];
            } else {
                animationCache = new AnimationCache(spData);
                animationCache._privateMode = this._privateMode;
            }
            animationCache.init(skeletonInfo, animationName);
            animationsCache[animationName] = animationCache;
        }
        animationCache.init(skeletonInfo, animationName);
        animationCache.setAnimation(animationName);
        return animationCache;
    }

    public destroyCachedAnimations (uuid?: string) {
        if (uuid) {
            const animationPool = this._animationPool;
            for (const key in animationPool) {
                if (key.includes(uuid)) {
                    animationPool[key].destory();
                    delete animationPool[key];
                }
            }
        } else {
            const animationPool = this._animationPool;
            for (const key in animationPool) {
                animationPool[key].destory();
                delete animationPool[key];
            }
        }
    }
}

export default SkeletonCache;
