import mongoose, { Document, Schema } from 'mongoose';

export interface Scene extends Document {
  name: string;
  temperature: number;
  active: boolean;
}

const SceneSchema = new Schema<Scene>({
  name: { type: String, required: true, unique: true },
  temperature: { type: Number, required: true },
  active: { type: Boolean, default: false },
});

export const SceneModel = mongoose.model<Scene>('Scene', SceneSchema);
