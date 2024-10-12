import asyncio
import json
import logging
import random
import string
from asyncio import sleep
from typing import Optional, AsyncGenerator

import uvicorn
from fastapi import FastAPI
from starlette.requests import Request
from starlette.responses import StreamingResponse


app = FastAPI()
logger = logging.getLogger()


# for mock delay: wait x seconds in between each partial result
mock_wait_secs: Optional[float] = None


lock = asyncio.Lock()

@app.get('/test')
async def process(req: Request, query: str, stream: Optional[bool] = False):
    params = {
        'query': query,
    }

    streaming = stream
    if streaming:
        result_gen = compute_until_stop(
            params, mock_wait_secs=mock_wait_secs
        )

        async def stream_results() -> AsyncGenerator[bytes, None]:
            # use lock for singleton access
            await lock.acquire()
            try:
                async for request_output in result_gen:
                    if request_output.get('complete') is True:
                        ret = {
                            'response': request_output['text'],
                            'complete': request_output['complete'],
                        }
                    else:
                        ret = request_output['text']
                        if len(ret) == 0:
                            continue
                    yield (json.dumps(ret) + '\0').encode('utf-8')

            finally:
                lock.release()
                logger.debug('  RELEASED LOCK stream for %s', params)

        logger.debug('  RETURN streaming response...')
        return StreamingResponse(stream_results())  # , background=background_tasks)

    # process non-streaming request:
    else:
        # use lock for singleton access
        await lock.acquire()
        try:
            logger.debug('  LOCK non-streaming for %s', params)

            result_gen = compute_until_stop(
                params, mock_wait_secs=mock_wait_secs
            )
            async for out in result_gen:
                if await req.is_disconnected():
                    logger.debug('  non-streaming response: CANCELED')
                    return {
                        'response': '',
                        'complete': False,
                        'aborted': True,
                    }
                output = out
        finally:
            lock.release()
            logger.debug(
                '  RELEASED non-streaming LOCK for %s!', params
            )

    logger.debug('Output for %s: %s', params, output)
    return {
        'response': output['text'],
        'complete': True,
    }


async def compute_until_stop(
    params,
    mock_wait_secs: float = 0.002,
    length: int = 250,
):
    try:
        query: str = params['query']
        output_text: str = query + ':\n' + ''.join(random.choices(string.ascii_lowercase, k=length))

        rest = len(output_text) - 1

        prev_out_len = 0
        while True:
            if rest < 1:
                logger.debug(
                    '  generating partial result (%s): COMPLETE', params['query']
                )
                break

            partial_output = output_text[prev_out_len:-rest]
            prev_out_len += len(partial_output)

            rest -= 1
            await sleep(mock_wait_secs)

            logger.debug(
                '  emitting partial generated output (rest: %s): len %s',
                rest,
                len(partial_output),
            )

            yield {'text': partial_output, 'partial': True, 'complete': False}

        logger.debug(
            '  emitting completed generated output:\n%s\n',
            output_text,
        )

        yield {'text': output_text, 'partial': False, 'complete': True}

    finally:
        logger.debug('  generator finished (%s)!', params['query'])


if __name__ == '__main__':

    logging.basicConfig(level=logging.DEBUG)
    mock_wait_secs = 0.5  # seconds
    logger.info('will wait %s seconds between partial results', mock_wait_secs)

    port = 8008
    uvicorn.run(app, host='0.0.0.0', port=port)
