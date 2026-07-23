import { SignIn } from '@clerk/nextjs';

export default function Page() {
  return (
    <div 
      className="min-h-screen flex bg-black relative"
      style={{
        backgroundImage: "url('/send_o3c_back_hetarth.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat"
      }}
    >
      {/* Background overlay with more blur */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md"></div>
      
      {/* Left Side - Logo (in front of background) */}
      <div className="flex-1 hidden lg:flex items-center justify-center p-8 relative z-10">
        <div className="max-w-4xl">
          <img 
            src="/cute-logo.png" 
            alt="O3C AI Platform" 
            className="w-[32rem] h-[32rem] object-contain mx-auto gentle-float drop-shadow-2xl"
          />
        </div>
      </div>
      
      {/* Right Side - Sign In (in front of background) */}
      <div className="flex-1 flex items-center justify-center p-8 relative z-10">
        <div className="w-full max-w-md bg-black/20 backdrop-blur-md rounded-2xl p-8 border border-white/10">
          <SignIn />
        </div>
      </div>
    </div>
  );
}