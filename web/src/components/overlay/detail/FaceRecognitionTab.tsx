import { useCallback, useMemo, useState } from "react";
import { SearchResult } from "@/types/search";
import { FrigateConfig } from "@/types/frigateConfig";
import { useApiHost } from "@/api";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LuRefreshCw } from "react-icons/lu";
import { FaUserCircle, FaUserPlus, FaTimes } from "react-icons/fa";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import useImageLoaded from "@/hooks/use-image-loaded";
import ImageLoadingIndicator from "@/components/indicators/ImageLoadingIndicator";
import FaceSelectionDialog from "@/components/overlay/FaceSelectionDialog";
import { useTranslation } from "react-i18next";
import useSWR from "swr";

type FaceRecognitionTabProps = {
  event: SearchResult;
  config?: FrigateConfig;
  faceNames: string[];
  isDesktop: boolean;
  side?: "left" | "right";
};

type FaceAttribute = {
  box: number[];
  label?: string;
  score?: number;
};

type TrainingFaceData = {
  filepath: string;
  filename: string;
  name: string;
  score?: number;
  eventId?: string;
};

export default function FaceRecognitionTab({
  event,
  config,
  faceNames,
  isDesktop,
  side,
}: FaceRecognitionTabProps) {
  useTranslation(["views/faceLibrary", "views/explore"]);
  const apiHost = useApiHost();
  const [imageRef, imageLoaded, onImageLoad] = useImageLoaded();
  const [isProcessing, setIsProcessing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Get face recognition thresholds from config
  const recognitionThreshold = config?.face_recognition?.recognition_threshold ?? 0.7;
  const unknownThreshold = config?.face_recognition?.unknown_score ?? 0.5;

  // Extract face attributes from event data
  const faceAttributes = useMemo<FaceAttribute[]>(() => {
    if (!event.data.attributes) return [];
    return event.data.attributes.filter(
      (attr: FaceAttribute) => attr.label === "face" || attr.box
    );
  }, [event.data.attributes]);

  // Fetch training faces for this event
  const { data: trainingFaces, mutate: refreshTrainingFaces } = useSWR<TrainingFaceData[]>(
    `faces/train?event_id=${event.id}`,
    async () => {
      // Get all training faces and filter by event ID
      const response = await axios.get(`${apiHost}api/faces`);
      const faces = response.data;
      const trainFaces = faces["train"] || [];

      // Parse training filenames to find faces for this event
      return trainFaces
        .filter((filename: string) => filename.includes(event.id.split("-")[0]))
        .map((filename: string) => {
          // Parse filename: {eventId1}-{eventId2}-{timestamp}-{faceName}-{score}.webp
          const parts = filename.replace(".webp", "").split("-");
          const score = parseFloat(parts[parts.length - 1]) || 0;
          const name = parts[parts.length - 2] || "unknown";
          return {
            filepath: `clips/faces/train/${filename}`,
            filename,
            name,
            score,
            eventId: event.id,
          };
        });
    },
    { revalidateOnFocus: false }
  );

  // Handle reprocess event
  const handleReprocess = useCallback(async () => {
    setIsProcessing(true);
    try {
      await axios.put(`${apiHost}api/faces/reprocess_event/${event.id}`);
      setRefreshKey((prev) => prev + 1);
      refreshTrainingFaces();
      toast.success("Face recognition reprocessed successfully");
    } catch (error) {
      console.error("Reprocess error:", error);
      toast.error("Failed to reprocess face recognition");
    }
    setIsProcessing(false);
  }, [apiHost, event.id, refreshTrainingFaces]);

  // Handle tag face
  const handleTagFace = useCallback(
    async (trainingFile: string, faceName: string) => {
      try {
        await axios.post(`${apiHost}api/faces/train/${faceName}/classify`, {
          training_file: trainingFile,
        });
        refreshTrainingFaces();
        toast.success(`Tagged face as ${faceName}`);
      } catch (error) {
        console.error("Tag face error:", error);
        toast.error("Failed to tag face");
      }
    },
    [apiHost, refreshTrainingFaces]
  );

  // Handle mark false positive
  const handleMarkFalsePositive = useCallback(
    async (trainingFile: string, currentName: string) => {
      try {
        await axios.post(`${apiHost}api/faces/${currentName}/flag_false_positive`, {
          ids: [trainingFile],
        });
        refreshTrainingFaces();
        toast.success("Marked as false positive");
      } catch (error) {
        console.error("Mark false positive error:", error);
        toast.error("Failed to mark as false positive");
      }
    },
    [apiHost, refreshTrainingFaces]
  );

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

  // Left side content - Snapshot with face boxes and detected faces grid
  const leftContent = (
    <div className="flex flex-col gap-4">
      {/* Snapshot with Face Boxes */}
      <div className="relative rounded-lg overflow-hidden bg-secondary" style={{ height: isDesktop ? "300px" : "200px" }}>
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
            <div className="relative" style={{ maxWidth: "100%", maxHeight: isDesktop ? "300px" : "200px" }}>
              <img
                key={refreshKey}
                ref={imageRef}
                style={{ maxWidth: "100%", maxHeight: isDesktop ? "300px" : "200px", objectFit: "contain" }}
                src={`${apiHost}api/events/${event.id}/snapshot.jpg?ts=${refreshKey}`}
                alt="Event snapshot"
                onLoad={onImageLoad}
              />
              {!imageLoaded && <ImageLoadingIndicator imgLoaded={imageLoaded} />}

              {/* Face Box Overlays */}
              {imageLoaded && faceAttributes.map((face, index) => {
                const [x, y, w, h] = face.box;
                const score = face.score ?? 0;
                return (
                  <div
                    key={index}
                    className={cn(
                      "absolute border-2 pointer-events-none",
                      getBoxColor(score)
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
                        "absolute -top-5 left-0 text-xs px-1 rounded bg-black/70",
                        getScoreColor(score)
                      )}
                    >
                      {(score * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </TransformComponent>
        </TransformWrapper>
      </div>

      {/* Detected Faces Grid */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium text-muted-foreground">
          Detected Faces ({trainingFaces?.length ?? 0})
        </h4>

        {(!trainingFaces || trainingFaces.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <FaUserCircle className="size-12 mb-2 opacity-50" />
            <p className="text-sm">No faces detected</p>
            <p className="text-xs">Click "Reprocess" to detect faces</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {trainingFaces.map((face) => (
              <div
                key={face.filename}
                className="relative rounded-lg overflow-hidden bg-secondary aspect-square group"
              >
                <img
                  className="w-full h-full object-cover"
                  src={`${apiHost}${face.filepath}`}
                  alt={face.name}
                />

                {/* Score Badge */}
                <div
                  className={cn(
                    "absolute top-1 right-1 text-xs px-1 rounded bg-black/70",
                    getScoreColor(face.score ?? 0)
                  )}
                >
                  {((face.score ?? 0) * 100).toFixed(0)}%
                </div>

                {/* Name Badge */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <span className="text-xs text-white truncate block">
                    {face.name === "unknown" ? "Unknown" : face.name}
                  </span>
                </div>

                {/* Action Buttons (shown on hover) */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <FaceSelectionDialog
                    faceNames={faceNames}
                    onTrainAttempt={(name) => handleTagFace(face.filename, name)}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-white hover:bg-white/20"
                      title="Tag face"
                    >
                      <FaUserPlus className="size-4" />
                    </Button>
                  </FaceSelectionDialog>

                  {face.name !== "unknown" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-white hover:bg-white/20"
                      title="Mark as false positive"
                      onClick={() => handleMarkFalsePositive(face.filename, face.name)}
                    >
                      <FaTimes className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Right side content - Reprocess button and technical details
  const rightContent = (
    <div className="flex flex-col gap-4">
      {/* Reprocess Button */}
      <Button
        variant="default"
        className="w-full"
        onClick={handleReprocess}
        disabled={isProcessing}
      >
        <LuRefreshCw className={cn("size-4 mr-2", isProcessing && "animate-spin")} />
        {isProcessing ? "Processing..." : "Reprocess Snapshot"}
      </Button>

      {/* Technical Details */}
      <div className="rounded-lg bg-secondary p-4 space-y-3">
        <h4 className="text-sm font-medium">Technical Details</h4>

        <div className="space-y-2 text-xs text-muted-foreground font-mono">
          <div className="flex justify-between">
            <span>Event ID:</span>
            <span className="truncate ml-2 max-w-[120px]" title={event.id}>
              {event.id.substring(0, 12)}...
            </span>
          </div>

          <div className="flex justify-between">
            <span>Face Count:</span>
            <span>{faceAttributes.length}</span>
          </div>

          <div className="flex justify-between">
            <span>Training Faces:</span>
            <span>{trainingFaces?.length ?? 0}</span>
          </div>

          <div className="flex justify-between">
            <span>Recognition Threshold:</span>
            <span>{(recognitionThreshold * 100).toFixed(0)}%</span>
          </div>

          <div className="flex justify-between">
            <span>Unknown Threshold:</span>
            <span>{(unknownThreshold * 100).toFixed(0)}%</span>
          </div>

          {event.sub_label && (
            <div className="flex justify-between">
              <span>Recognized As:</span>
              <span className="text-green-500">{event.sub_label}</span>
            </div>
          )}

          {event.data.sub_label_score && (
            <div className="flex justify-between">
              <span>Recognition Score:</span>
              <span className={getScoreColor(event.data.sub_label_score)}>
                {(event.data.sub_label_score * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Face Box Coordinates (if any) */}
      {faceAttributes.length > 0 && (
        <div className="rounded-lg bg-secondary p-4 space-y-3">
          <h4 className="text-sm font-medium">Face Regions</h4>
          <div className="space-y-2 text-xs text-muted-foreground font-mono max-h-48 overflow-y-auto">
            {faceAttributes.map((face, index) => (
              <div key={index} className="border-b border-border pb-2 last:border-0 last:pb-0">
                <div className="font-semibold mb-1">Face {index + 1}</div>
                <div>Box: [{face.box.map(v => v.toFixed(3)).join(", ")}]</div>
                {face.score !== undefined && (
                  <div className={getScoreColor(face.score)}>
                    Score: {(face.score * 100).toFixed(1)}%
                  </div>
                )}
              </div>
            ))}
          </div>
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
