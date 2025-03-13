const Home = () => {
  const categories = {
    'Basic chat': 'basic-chat',
    'Function calling': 'function-calling',
    'File search': 'file-search',
    All: 'all',
  };

  return (
    <main className='flex h-screen flex-col items-center justify-center bg-white'>
      <div className='mb-5 text-[1.5em] font-semibold'>
        Explore sample apps built with Assistants API
      </div>
      <div className='box-border flex w-full max-w-6xl flex-row items-center justify-center gap-5 p-5'>
        {Object.entries(categories).map(([name, url]) => (
          <a
            key={name}
            className='text-black! rounded-4xl flex size-32 max-w-2xl cursor-pointer items-center justify-center bg-[#efefef] p-5 text-center text-[1em] font-medium [transition:background-color_0.3s_ease] hover:bg-[#e3e3eb]'
            href={`/examples/${url}`}
          >
            {name}
          </a>
        ))}
        <a
          key='translate'
          className='text-black! rounded-4xl flex size-32 max-w-2xl cursor-pointer items-center justify-center bg-[#efefef] p-5 text-center text-[1em] font-medium [transition:background-color_0.3s_ease] hover:bg-[#e3e3eb]'
          href={`/translate`}
        >
          Translate
        </a>
      </div>
    </main>
  );
};

export default Home;
