<!--
title: How I Made My Object Tracker 13× Faster by Deleting the Fancy Parts
date: 2026-08-10
description: How swapping PyTorch for ONNX Runtime and DeepSORT for a 40-line IoU tracker took a CPU-only object tracker from ~4.7 to ~64 FPS.
-->


I built a real-time object tracker. The first version worked — and crawled at ~4.7 FPS on my laptop. The current version runs at ~64 FPS on the **same CPU, no GPU**. This is the story of how, and the punchline is boring: I got faster by throwing away the heavy, "smart" components and replacing them with simpler ones.

## v1: YOLOv8 + DeepSORT (the textbook stack)

The obvious way to build a tracker is the way every tutorial does it:

- **YOLOv8** (`ultralytics`, `.pt` weights) for detection
- **DeepSORT** for tracking identities across frames

DeepSORT is genuinely clever. For every detection it runs a small CNN to extract an appearance "fingerprint," keeps a Kalman filter per track to predict motion, and matches detections to tracks using both. That's how it keeps ID #3 attached to the same person even when they briefly walk behind a pole.

```python
from ultralytics import YOLO
from deep_sort_realtime.deepsort_tracker import DeepSort

model = YOLO("yolov8n.pt")
tracker = DeepSort(max_age=30)
```

It's accurate. It's also **slow on CPU**. Two things were eating my frame budget:

1. **PyTorch inference** through `ultralytics` — ~210 ms per frame.
2. **DeepSORT's re-ID CNN** — ~30 ms per frame, on top of the Kalman bookkeeping.

At ~240 ms of work per frame, ~4.7 FPS is exactly what you'd expect. On a machine with a GPU this is a non-issue. I didn't have one. So the question became: *what am I actually paying for, and do I need it?*

## The realization

I was tracking cars and people in fairly ordinary video. Objects don't teleport between frames — they move a little. Their bounding box this frame overlaps heavily with their box last frame. So do I really need a CNN to tell me "this box is the same object as that box"? Or is *box overlap* enough?

For my use case, box overlap is enough. That single question is the whole optimization.

## v2: Swap PyTorch for ONNX Runtime

First, kill the biggest cost — inference. I exported the same YOLOv8n weights to ONNX and ran them through `onnxruntime` directly, skipping the `ultralytics` wrapper entirely:

```python
import onnxruntime as ort

self.session = ort.InferenceSession(
    "yolov8n.onnx", providers=["CPUExecutionProvider"]
)
```

Same model, same weights, same detections — but ONNX Runtime's CPU kernels are dramatically better optimized than stock PyTorch for this. Inference dropped from ~210 ms to ~36 ms at 320×320. Just this change roughly **2.5×'d** the whole pipeline (~12 FPS). I did nothing to the tracking yet.

## v3: Replace DeepSORT with a 40-line IoU tracker

Now the tracker. Instead of a CNN + Kalman filter, I match boxes by **Intersection-over-Union** — the ratio of overlap area to combined area. Every frame:

1. Compute IoU between each existing track's last box and each new detection.
2. Greedily match the highest-overlap pairs above a threshold.
3. Unmatched detections become new tracks; unmatched tracks age out after `max_age` frames.

The core is pure geometry, no learning:

```python
class IoUTracker:
    def __init__(self, iou_threshold=0.3, max_age=15):
        self.iou_threshold = iou_threshold
        self.max_age = max_age
        self.tracks = OrderedDict()
        self._next_id = 1

    def update(self, boxes):
        track_ids = list(self.tracks.keys())
        track_boxes = [self.tracks[tid]["bbox"] for tid in track_ids]
        results = []

        if track_boxes:
            iou_matrix = self._compute_iou_matrix(track_boxes, boxes)
            while iou_matrix.size:
                i, j = np.unravel_index(iou_matrix.argmax(), iou_matrix.shape)
                if iou_matrix[i, j] < self.iou_threshold:
                    break
                tid = track_ids[i]
                self.tracks[tid]["bbox"] = boxes[j]  # matched: update
                self.tracks[tid]["age"] = 0
                results.append((tid, boxes[j]))
                iou_matrix[i, :] = 0   # remove this pair from contention
                iou_matrix[:, j] = 0
        # ... age out unmatched tracks, register new detections as fresh IDs
        return results
```

And the IoU matrix itself is one vectorized NumPy block — no Python loops over boxes:

```python
@staticmethod
def _compute_iou_matrix(boxes_a, boxes_b):
    a = np.array(boxes_a, dtype=np.float32)
    b = np.array(boxes_b, dtype=np.float32)
    x1 = np.maximum(a[:, 0:1], b[:, 0].T)
    y1 = np.maximum(a[:, 1:2], b[:, 1].T)
    x2 = np.minimum(a[:, 2:3], b[:, 2].T)
    y2 = np.minimum(a[:, 3:4], b[:, 3].T)
    inter = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    union = area_a[:, None] + area_b[None, :] - inter
    return inter / np.maximum(union, 1e-6)
```

DeepSORT cost ~30 ms per frame. This costs **under 0.1 ms**. It's ~40 lines and has no model to load.

## Two more cheap wins

While I was in there, two things that cost nothing but multiply throughput:

- **Frame skipping** — run detection every 3rd frame and let the tracker coast on the last boxes in between. Tracking is cheap, so the in-between frames are basically free. 3× effective throughput.
- **Threaded capture** — read frames from the camera/video in a background thread so disk/camera I/O never blocks inference:

```python
outputs = self.ort_session.run(None, {self._onnx_input_name: img})
```

## The scoreboard

| Version | Detector | Tracker | FPS | Speedup |
|--------|----------|---------|-----|---------|
| v1 | YOLOv8 `.pt` (PyTorch) | DeepSORT | ~4.7 | 1× |
| v2 | YOLOv8 ONNX | DeepSORT | ~12 | 2.5× |
| v3 | YOLOv8 ONNX | IoU tracker | ~64 | **13.6×** |

Same laptop. Same CPU. No GPU anywhere.

## What I gave up (and why it was fine)

The IoU tracker has no memory of what an object *looks like*. If two objects fully overlap and swap positions, or one is occluded for longer than `max_age` frames, it can swap or drop IDs — cases DeepSORT's appearance model would survive. For general "count and follow objects moving normally through a scene," I never hit those cases in practice. If I ever need bulletproof identity through heavy occlusion, DeepSORT goes back in — as an *option*, not the default.

## The lesson

The fast version isn't fast because I wrote clever code. It's fast because I wrote **less** code, after asking what each expensive component was actually buying me. The CNN re-ID and the Kalman filter were solving a problem I didn't have. Once I named the real requirement — "keep IDs stable for objects moving normally" — the honest answer was 40 lines of box overlap.

Reach for the heavy, general-purpose tool when you actually need it. Until then, geometry runs on a CPU just fine.
