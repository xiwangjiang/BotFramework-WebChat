/* eslint class-methods-use-this: ["error", { "exceptMethods": ["cancel", "getVoices", "speak"] }] */

import { createSpeechRecognitionPonyfillFromRecognizer } from 'web-speech-cognitive-services/lib/SpeechServices/SpeechToText';

import AbortController from 'abort-controller-es5';
import createCustomEvent from './createCustomEvent';
import createErrorEvent from './createErrorEvent';
import createTaskQueue from './createTaskQueue';
import EventTargetShim, { defineEventAttribute } from 'event-target-shim-es5';
import playCognitiveServicesStream from './playCognitiveServicesStream';
import playWhiteNoise from './playWhiteNoise';
import SpeechSynthesisAudioStreamUtterance from './SpeechSynthesisAudioStreamUtterance';

export default function({
  audioContext,
  enableTelemetry,
  ponyfill = {
    AudioContext: window.AudioContext || window.webkitAudioContext
  },
  recognizer,
  textNormalization
}) {
  if (!ponyfill.AudioContext) {
    console.warn(
      'botframework-directlinespeech-sdk: This browser does not support Web Audio API. Speech support is disabled.'
    );

    return () => ({});
  }

  return () => {
    const { SpeechGrammarList, SpeechRecognition } = createSpeechRecognitionPonyfillFromRecognizer({
      createRecognizer: () => recognizer,
      enableTelemetry,
      looseEvents: true,
      textNormalization
    });

    if (!audioContext) {
      audioContext = new ponyfill.AudioContext();
    }

    const { cancelAll, push } = createTaskQueue();

    class SpeechSynthesis extends EventTargetShim {
      cancel() {
        cancelAll();
      }

      // Returns an empty array.
      // Synthesis is done on the bot side, the content of the voice list is not meaningful on the client side.
      getVoices() {
        return [];
      }

      speak(utterance) {
        const { result } = push(() => {
          const controller = new AbortController();
          const { signal } = controller;

          return {
            abort: controller.abort.bind(controller),
            result: (async () => {
              utterance.dispatchEvent(createCustomEvent('start'));

              try {
                if (utterance.audioStream) {
                  await playCognitiveServicesStream(audioContext, utterance.audioStream, { signal });
                } else {
                  await playWhiteNoise(audioContext);
                }
              } catch (error) {
                // Either dispatch "end" or "error" event, but not both
                if (error.message !== 'aborted') {
                  return utterance.dispatchEvent(createErrorEvent(error));
                }
              }

              utterance.dispatchEvent(createCustomEvent('end'));
            })()
          };
        });

        // Catching the error to prevent uncaught promise error due to cancellation.
        result.catch(error => {
          if (!/^cancelled/iu.test(error.message)) {
            throw error;
          }
        });
      }
    }

    defineEventAttribute(SpeechSynthesis, 'voiceschanged');

    return {
      SpeechGrammarList,
      SpeechRecognition,
      speechSynthesis: new SpeechSynthesis(),
      SpeechSynthesisUtterance: SpeechSynthesisAudioStreamUtterance
    };
  };
}
