import mongoose, { Document, Schema } from 'mongoose';

export interface Setting extends Document {
  key: string;
  value: number;
  updatedAt: Date;
  hysteresis?: number;
}

const SettingSchema = new Schema<Setting>({
  key: { type: String, required: true, unique: true },
  value: { type: Number, required: true },
  updatedAt: { type: Date, required: true },
  hysteresis: { type: Number },
});

SettingSchema.index({ key: 1 }); // Crear índice en el campo 'key'

export const SettingModel = mongoose.model<Setting>('Setting', SettingSchema);
