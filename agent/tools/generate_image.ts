import { generateImage } from "ai";
import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { chatSessionId, requireUser } from "../lib/identity";
import { createUserDocument, toClientDocument } from "../../lib/documents";
import {
  IMAGE_GENERATION_MODEL,
  type GenerateImageOutput,
} from "../../lib/generated-image";
import { estimateImageCostUsd, estimateUsageCost } from "../../lib/model-prices";
import { recordModelUsage } from "../../lib/record-usage";
import { resolveChatForEveSession } from "../../lib/session-memory";
import { tokensFromUnknownUsage } from "../../lib/usage";
import { runWithUsageScope } from "../../lib/usage-scope";

const sizeSchema = z.enum(["1024x1024", "1536x1024", "1024x1536"]);
const qualitySchema = z.enum(["low", "medium", "high"]);

function extensionFor(mediaType: string): string {
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  return "png";
}

export default defineTool({
  description:
    "Generate an image from a text prompt using GPT Image 2. Use after loading the image skill when the user wants a visual, illustration, or mood board.",
  inputSchema: z.object({
    prompt: z
      .string()
      .min(8)
      .max(4000)
      .describe("A detailed visual prompt for the image to generate."),
    quality: qualitySchema
      .optional()
      .describe("Rendering quality. Defaults to medium."),
    size: sizeSchema.optional().describe("Pixel size. Defaults to 1024x1024."),
  }),
  async execute({ prompt, quality = "medium", size = "1024x1024" }, ctx) {
    const result = await generateImage({
      abortSignal: ctx.abortSignal,
      model: IMAGE_GENERATION_MODEL,
      prompt,
      providerOptions: {
        openai: { quality },
      },
      size,
    });
    try {
      const user = requireUser(ctx);
      const chat = await resolveChatForEveSession(user.userId, chatSessionId(ctx), user.chatId);
      const tokens = tokensFromUnknownUsage(result.usage);
      const hasTokens = tokens.inputTokens > 0 || tokens.outputTokens > 0;
      await runWithUsageScope({ userId: user.userId, chatId: chat?.id }, () =>
        recordModelUsage({
          ...tokens,
          chatId: chat?.id,
          costUsd: hasTokens
            ? estimateUsageCost(IMAGE_GENERATION_MODEL, tokens)
            : estimateImageCostUsd(quality, size, result.images.length),
          modelId: IMAGE_GENERATION_MODEL,
          purpose: "image",
          userId: user.userId,
        }),
      );
    } catch (error) {
      console.error("[usage] image record failed", error);
    }

    const images = result.images.map((image, index) => {
      const mediaType = image.mediaType || "image/png";
      return {
        base64: image.base64,
        filename: `generated-${index + 1}.${extensionFor(mediaType)}`,
        mediaType,
      };
    });

    if (images.length === 0) {
      throw new Error("The image model did not return an image.");
    }

    let documents: GenerateImageOutput["documents"] = [];
    try {
      const user = requireUser(ctx);
      documents = await Promise.all(
        images.map(async (image) => {
          const document = await createUserDocument(user.userId, {
            content: Buffer.from(image.base64, "base64"),
            eveSessionId: chatSessionId(ctx),
            filename: image.filename,
            kind: "image",
            mimeType: image.mediaType,
            title: prompt.slice(0, 72) || image.filename,
          });
          const client = toClientDocument(document, []);
          return { href: client.href, id: client.id, title: client.title };
        }),
      );
    } catch {
      documents = [];
    }

    return {
      documents,
      images,
      model: IMAGE_GENERATION_MODEL,
      prompt,
      quality,
      size,
    } satisfies GenerateImageOutput;
  },
  toModelOutput(output) {
    const saved =
      output.documents && output.documents.length > 0
        ? ` Saved as file(s): ${output.documents.map((document) => document.title).join(", ")}.`
        : "";
    return toolOutput.content([
      toolOutputPart.text(
        `Generated ${output.images.length} image(s) with ${output.model} (${output.size}, ${output.quality}). Prompt: ${output.prompt}.${saved}`,
      ),
      ...output.images.map((image) =>
        toolOutputPart.file(image.base64, {
          filename: image.filename,
          mediaType: image.mediaType,
        }),
      ),
    ]);
  },
});
