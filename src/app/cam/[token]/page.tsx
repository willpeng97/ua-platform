import { CameraPublisher } from "@/components/camera-publisher";

type Props = { params: Promise<{ token: string }> };

export default async function CamPage({ params }: Props) {
  const { token } = await params;
  return <CameraPublisher token={token} />;
}
