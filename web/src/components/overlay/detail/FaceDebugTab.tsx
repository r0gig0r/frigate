import { useCallback, useState } from "react";
import { SearchResult } from "@/types/search";
import { FrigateConfig } from "@/types/frigateConfig";
import { useApiHost } from "@/api";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LuRefreshCw, LuCopy } from "react-icons/lu";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import useImageLoaded from "@/hooks/use-image-loaded";
import ImageLoadingIndicator from "@/components/indicators/ImageLoadingIndicator";

type FaceDebugTabProps = {
  event: SearchResult;
  config?: FrigateConfig;
  isDesktop: boolean;
  side?: "left" | "right";
};

type DebugFaceData = {
  filename: string;
  face_name: string;
  score: number;
  box: number[]; // normalized [x, y, w, h]
  pixel_box?: number[]; // pixel coordinates [x1, y1, x2, y2]
  crop_image?: string; // base64 encoded cropped face
};

type DebugResponse = {
  success: boolean;
  message: string;
  faces: DebugFaceData[];
  snapshot_dimensions?: { width: number; height: number };
  detection_threshold?: number;
  recognition_threshold?: number;
  unknown_threshold?: number;
};

export default function FaceDebugTab({
  event,
  config,
  isDesktop,
  side,
}: FaceDebugTabProps) {
  const apiHost = useApiHost();
  const [imageRef, imageLoaded, onImageLoad] = useImageLoaded();
  const [isProcessing, setIsProcessing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [debugData, setDebugData] = useState<DebugResponse | null>(null);

  // Get face recognition thresholds from config
  const recognitionThreshold = config?.face_recognition?.recognition_threshold ?? 0.7;
  const unknownThreshold = config?.face_recognition?.unknown_score ?? 0.5;
  const detectionThreshold = config?.face_recognition?.detection_threshold ?? 0.7;

  // Handle debug reprocess
  const handleDebugReprocess = useCallback(async () => {
    setIsProcessing(true);
    try {
      const response = await axios.put(`${apiHost}api/faces/reprocess_event/${event.id}`);
      setRefreshKey((prev) => prev + 1);
      setDebugData(response.data);
      toast.success("Debug reprocess completed");
    } catch (error) {
      console.error("Debug reprocess error:", error);
      toast.error("Failed to debug reprocess");
      setDebugData(null);
    }
    setIsProcessing(false);
  }, [apiHost, event.id]);

  // Copy debug data to clipboard
  const handleCopyDebugData = useCallback(() => {
    if (debugData) {
      navigator.clipboard.writeText(JSON.stringify(debugData, null, 2));
      toast.success("Debug data copied to clipboard");
    }
  }, [debugData]);

  // Get color for score
  const getScoreColor = useCallback(
    (score: number) => {
      if (score >= recognitionThreshold) return "text-green-500";
      if (score >= unknownThreshold) return "text-orange-500";
      return "text-red-500";
    },
    [recognitionThreshold, unknownThreshold]
  );

  const getBoxColor = useCallback(
    (score: number) => {
      if (score >= recognitionThreshold) return "border-green-500";
      if (score >= unknownThreshold) return "border-orange-500";
      return "border-red-500";
    },
    [recognitionThreshold, unknownThreshold]
  );

  // Left side content - Snapshot with debug overlays and face crops
  const leftContent = (
    <div className="flex flex-col gap-4">
      {/* Original Snapshot with Detection Boxes */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium text-muted-foreground">Original Snapshot with Detection Boxes</h4>
        <div className="relative rounded-lg overflow-hidden bg-secondary" style={{ height: isDesktop ? "400px" : "250px" }}>
          <TransformWrapper minScale={1} maxScale={10} wheel={{ smoothStep: 0.04 }}>
            <TransformComponent
              wrapperStyle={{
                width: "100%",
                height: "100%",
              }}
              contentStyle={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div className="relative" style={{ maxWidth: "100%", maxHeight: isDesktop ? "400px" : "250px" }}>
                <img
                  key={refreshKey}
                  ref={imageRef}
                  style={{ maxWidth: "100%", maxHeight: isDesktop ? "400px" : "250px", objectFit: "contain" }}
                  src={`${apiHost}api/events/${event.id}/snapshot.jpg?ts=${refreshKey}`}
                  alt="Event snapshot"
                  onLoad={onImageLoad}
                />
                {!imageLoaded && <ImageLoadingIndicator imgLoaded={imageLoaded} />}

                {/* Face Detection Boxes */}
                {imageLoaded && debugData?.faces.map((face, index) => {
                  const [x, y, w, h] = face.box;
                  return (
                    <div
                      key={index}
                      className={cn(
                        "absolute border-2 pointer-events-none",
                        getBoxColor(face.score)
                      )}
                      style={{
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        width: `${w * 100}%`,
                        height: `${h * 100}%`,
                      }}
                    >
                      <span
                        className={cn(
                          "absolute -top-6 left-0 text-xs px-1 rounded bg-black/90 text-white"
                        )}
                      >
                        Face {index + 1}
                      </span>
                      <span
                        className={cn(
                          "absolute -bottom-6 left-0 text-xs px-1 rounded bg-black/70",
                          getScoreColor(face.score)
                        )}
                      >
                        {(face.score * 100).toFixed(0)}% - {face.face_name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </TransformComponent>
          </TransformWrapper>
        </div>
      </div>

      {/* Detected Face Crops */}
      {debugData && debugData.faces.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Cropped Faces Sent to Recognition ({debugData.faces.length})
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {debugData.faces.map((face, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-lg bg-secondary p-3"
              >
                <div className="text-xs font-semibold text-center">Face {index + 1}</div>
                {face.crop_image ? (
                  <img
                    className="w-full aspect-square object-cover rounded border-2 border-border"
                    src={`data:image/jpeg;base64,${face.crop_image}`}
                    alt={`Face ${index + 1}`}
                  />
                ) : (
                  <div className="w-full aspect-square rounded border-2 border-border bg-secondary flex items-center justify-center text-xs text-muted-foreground">
                    No crop data
                  </div>
                )}
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name:</span>
                    <span className={getScoreColor(face.score)}>{face.face_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Score:</span>
                    <span className={getScoreColor(face.score)}>{(face.score * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Size:</span>
                    <span>{Math.round(face.box[2] * (debugData.snapshot_dimensions?.width ?? 1))}×{Math.round(face.box[3] * (debugData.snapshot_dimensions?.height ?? 1))}px</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // Right side content - Debug information and controls
  const rightContent = (
    <div className="flex flex-col gap-4">
      {/* Debug Controls */}
      <Button
        variant="default"
        className="w-full"
        onClick={handleDebugReprocess}
        disabled={isProcessing}
      >
        <LuRefreshCw className={cn("size-4 mr-2", isProcessing && "animate-spin")} />
        {isProcessing ? "Processing..." : "Run Debug Reprocess"}
      </Button>

      {debugData && (
        <Button
          variant="outline"
          className="w-full"
          onClick={handleCopyDebugData}
        >
          <LuCopy className="size-4 mr-2" />
          Copy Debug Data
        </Button>
      )}

      {/* Pipeline Configuration */}
      <div className="rounded-lg bg-secondary p-4 space-y-3">
        <h4 className="text-sm font-medium">Pipeline Configuration</h4>
        <div className="space-y-2 text-xs text-muted-foreground font-mono">
          <div className="flex justify-between">
            <span>Detection Threshold:</span>
            <span>{(detectionThreshold * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Recognition Threshold:</span>
            <span className="text-green-500">{(recognitionThreshold * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Unknown Threshold:</span>
            <span className="text-orange-500">{(unknownThreshold * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Model Size:</span>
            <span>{config?.face_recognition?.model_size ?? "default"}</span>
          </div>
        </div>
      </div>

      {/* Processing Results */}
      {debugData && (
        <div className="rounded-lg bg-secondary p-4 space-y-3">
          <h4 className="text-sm font-medium">Processing Results</h4>
          <div className="space-y-2 text-xs text-muted-foreground font-mono">
            <div className="flex justify-between">
              <span>Status:</span>
              <span className={debugData.success ? "text-green-500" : "text-red-500"}>
                {debugData.success ? "Success" : "Failed"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Faces Detected:</span>
              <span>{debugData.faces.length}</span>
            </div>
            {debugData.snapshot_dimensions && (
              <div className="flex justify-between">
                <span>Snapshot Size:</span>
                <span>{debugData.snapshot_dimensions.width}×{debugData.snapshot_dimensions.height}</span>
              </div>
            )}
            <div className="col-span-2 pt-2 border-t border-border">
              <div className="text-xs">{debugData.message}</div>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Face Data */}
      {debugData && debugData.faces.length > 0 && (
        <div className="rounded-lg bg-secondary p-4 space-y-3">
          <h4 className="text-sm font-medium">Detailed Face Data</h4>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {debugData.faces.map((face, index) => (
              <div key={index} className="border border-border rounded p-2 space-y-1 text-xs font-mono">
                <div className="font-semibold mb-2">Face {index + 1}</div>

                <div className="grid grid-cols-2 gap-1">
                  <span className="text-muted-foreground">Recognition:</span>
                  <span className={getScoreColor(face.score)}>{face.face_name}</span>

                  <span className="text-muted-foreground">Score:</span>
                  <span className={getScoreColor(face.score)}>{(face.score * 100).toFixed(2)}%</span>
                </div>

                <div className="pt-2 mt-2 border-t border-border">
                  <div className="text-muted-foreground mb-1">Normalized Box [x, y, w, h]:</div>
                  <div className="text-xs bg-background p-1 rounded">
                    [{face.box.map(v => v.toFixed(4)).join(", ")}]
                  </div>
                </div>

                {face.pixel_box && (
                  <div className="pt-2 mt-2 border-t border-border">
                    <div className="text-muted-foreground mb-1">Pixel Box [x1, y1, x2, y2]:</div>
                    <div className="text-xs bg-background p-1 rounded">
                      [{face.pixel_box.join(", ")}]
                    </div>
                  </div>
                )}

                <div className="pt-2 mt-2 border-t border-border">
                  <div className="grid grid-cols-2 gap-1">
                    <span className="text-muted-foreground">Passes Detection:</span>
                    <span className={face.score >= detectionThreshold ? "text-green-500" : "text-red-500"}>
                      {face.score >= detectionThreshold ? "YES" : "NO"}
                    </span>

                    <span className="text-muted-foreground">Passes Recognition:</span>
                    <span className={face.score >= recognitionThreshold ? "text-green-500" : "text-orange-500"}>
                      {face.score >= recognitionThreshold ? "YES" : "MAYBE"}
                    </span>

                    <span className="text-muted-foreground">Above Unknown:</span>
                    <span className={face.score >= unknownThreshold ? "text-green-500" : "text-red-500"}>
                      {face.score >= unknownThreshold ? "YES" : "NO"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw JSON Response */}
      {debugData && (
        <div className="rounded-lg bg-secondary p-4 space-y-3">
          <h4 className="text-sm font-medium">Raw API Response</h4>
          <pre className="text-xs bg-background p-2 rounded overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(debugData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );

  // Render based on side prop
  if (side === "left") {
    return leftContent;
  }

  if (side === "right") {
    return rightContent;
  }

  // Mobile: render both in a column
  return (
    <div className="flex flex-col gap-4">
      {leftContent}
      {rightContent}
    </div>
  );
}
