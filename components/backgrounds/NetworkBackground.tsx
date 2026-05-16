export default function NetworkBackground() {
    return (
      <>
        <div
          className="
            absolute inset-0
            bg-gradient-to-br
            from-slate-950
            via-slate-900
            to-blue-950
          "
        />
  
        <div
          className="
            absolute
            top-[-200px]
            right-[-100px]
            w-[500px]
            h-[500px]
            bg-blue-500/20
            rounded-full
            blur-3xl
          "
        />
  
        <div
          className="
            absolute
            bottom-[-200px]
            left-[-100px]
            w-[400px]
            h-[400px]
            bg-cyan-400/10
            rounded-full
            blur-3xl
          "
        />
  
        {/* Network SVG */}
        <svg
          className="absolute inset-0 w-full h-full opacity-20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <line x1="10%" y1="20%" x2="25%" y2="35%" stroke="#38bdf8" />
          <line x1="25%" y1="35%" x2="40%" y2="15%" stroke="#38bdf8" />
          <line x1="40%" y1="15%" x2="60%" y2="40%" stroke="#38bdf8" />
          <line x1="60%" y1="40%" x2="80%" y2="25%" stroke="#38bdf8" />
  
          <circle cx="10%" cy="20%" r="4" fill="#38bdf8" />
          <circle cx="25%" cy="35%" r="4" fill="#38bdf8" />
          <circle cx="40%" cy="15%" r="4" fill="#38bdf8" />
          <circle cx="60%" cy="40%" r="4" fill="#38bdf8" />
          <circle cx="80%" cy="25%" r="4" fill="#38bdf8" />
        </svg>
      </>
    );
  }