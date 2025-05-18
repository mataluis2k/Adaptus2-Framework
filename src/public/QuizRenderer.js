/**
 * QuizRenderer.js - A client library for rendering interactive quizzes
 * 
 * @module QuizRenderer
 * @version 1.0.0
 */

const QuizRenderer = (function() {
    // Private variables
    let container = null;
    let quizData = null;
    let currentQuestionIndex = 0;
    let responses = [];
    let config = {
      quizId: null,
      onComplete: null,
      submitUrl: '/api/quiz-submit',
      themeClass: null
    };
  
    /**
     * Initialize the quiz renderer
     * @param {string} containerId - ID of container element
     * @param {Object} options - Configuration options
     * @param {string} options.quizId - ID of quiz to fetch
     * @param {Function} [options.onComplete] - Callback on quiz completion
     * @param {string} [options.themeClass] - CSS class for theming
     * @param {string} [options.submitUrl] - URL for quiz submission
     * @returns {Object} - QuizRenderer instance
     */
    function init(containerId, options = {}) {
      // Get container element
      container = document.getElementById(containerId);
      if (!container) {
        console.error(`Container element with ID '${containerId}' not found.`);
        return;
      }
  
      // Merge user options with defaults
      config = { ...config, ...options };
      
      // Validate required options
      if (!config.quizId) {
        console.error('Missing required option: quizId');
        renderError('Quiz configuration error: Missing quiz ID');
        return;
      }
  
      // Apply theme class if provided
      if (config.themeClass) {
        container.classList.add(config.themeClass);
      }
  
      // Add base classes
      container.classList.add('quiz-renderer-container');
  
      // Show loading indicator and fetch quiz data
      renderLoading();
      fetchQuizData()
        .then(data => {
          quizData = sanitizeQuizData(data);
          renderQuiz();
        })
        .catch(error => {
          console.error('Failed to fetch quiz data:', error);
          renderError('Failed to load quiz. Please try again.');
        });
  
      // Return public methods
      return {
        reset: resetQuiz,
        getResponses: () => responses
      };
    }
  
    /**
     * Fetch quiz data from API
     * @returns {Promise<Object>} Quiz data
     */
    async function fetchQuizData() {
      try {
        const response = await fetch(`/api/quiz_render/${encodeURIComponent(config.quizId)}`);
        
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        
        return await response.json();
      } catch (error) {
        throw new Error(`Failed to fetch quiz data: ${error.message}`);
      }
    }
  
    /**
     * Sanitize HTML in quiz data to prevent XSS
     * @param {Object} data - Raw quiz data
     * @returns {Object} Sanitized quiz data
     */
    function sanitizeQuizData(data) {
      // Simple HTML sanitizer
      const sanitizeHTML = (html) => {
        const element = document.createElement('div');
        element.textContent = html;
        return element.innerHTML;
      };
  
      // Create a deep copy to avoid modifying the original
      const sanitized = JSON.parse(JSON.stringify(data));
      
      // Sanitize quiz name
      if (sanitized.quiz_name) {
        sanitized.quiz_name = sanitizeHTML(sanitized.quiz_name);
      }
      
      // Sanitize questions
      if (sanitized.questions && Array.isArray(sanitized.questions)) {
        sanitized.questions = sanitized.questions.map(question => {
          if (question.text) {
            question.text = sanitizeHTML(question.text);
          }
          
          // Sanitize answers
          if (question.question_answers && Array.isArray(question.question_answers)) {
            question.question_answers = question.question_answers.map(answer => {
              if (answer.answer) {
                answer.answer = sanitizeHTML(answer.answer);
              }
              return answer;
            });
            
            // Sort answers by order if present
            question.question_answers.sort((a, b) => (a.order || 0) - (b.order || 0));
          }
          
          return question;
        });
      }
      
      return sanitized;
    }
  
    /**
     * Render loading indicator
     */
    function renderLoading() {
      container.innerHTML = `
        <div class="quiz-loading" aria-live="polite">
          <div class="quiz-spinner"></div>
          <p>Loading quiz...</p>
        </div>
      `;
    }
  
    /**
     * Render error message with retry button
     * @param {string} message - Error message
     */
    function renderError(message) {
      container.innerHTML = `
        <div class="quiz-error" aria-live="assertive">
          <p>${message}</p>
          <button class="quiz-retry-button" aria-label="Retry loading quiz">
            Retry
          </button>
        </div>
      `;
      
      // Add retry button event listener
      const retryButton = container.querySelector('.quiz-retry-button');
      if (retryButton) {
        retryButton.addEventListener('click', () => {
          renderLoading();
          fetchQuizData()
            .then(data => {
              quizData = sanitizeQuizData(data);
              renderQuiz();
            })
            .catch(error => {
              console.error('Failed to fetch quiz data:', error);
              renderError('Failed to load quiz. Please try again.');
            });
        });
      }
    }
  
    /**
     * Render the quiz interface
     */
    function renderQuiz() {
      // Validate quiz data
      if (!quizData || !quizData.questions || !Array.isArray(quizData.questions) || quizData.questions.length === 0) {
        renderError('Invalid quiz data. Please try a different quiz.');
        return;
      }
  
      // Initialize responses array if empty
      if (responses.length === 0) {
        responses = quizData.questions.map(question => ({
          question_id: question.question_id,
          answer_id: null,
          user_input: null
        }));
      }
  
      // Create main layout
      container.innerHTML = `
        <div class="quiz-content">
          <header class="quiz-header">
            <h1>${quizData.quiz_name || 'Quiz'}</h1>
          </header>
          <div class="quiz-body" aria-live="polite">
            <!-- Question will be rendered here -->
          </div>
          <footer class="quiz-footer">
            <div class="quiz-navigation">
              <button class="quiz-prev-button" aria-label="Previous question">Previous</button>
              <span class="quiz-progress">${currentQuestionIndex + 1} of ${quizData.questions.length}</span>
              <button class="quiz-next-button" aria-label="Next question">Next</button>
            </div>
          </footer>
        </div>
      `;
  
      // Apply styling if provided
      if (quizData.styling) {
        applyStyles(quizData.styling);
      }
  
      // Render current question
      renderQuestion();
  
      // Add event listeners for navigation
      setupNavigation();
    }
  
    /**
     * Apply styles from quiz data
     * @param {Object} styling - Styling configuration
     */
    function applyStyles(styling) {
      // Create a style element
      const styleElement = document.createElement('style');
      
      // Create CSS rules from styling object
      let css = `.quiz-renderer-container {`;
      
      // Apply colors
      if (styling.primaryColor) {
        css += `--quiz-primary-color: ${styling.primaryColor};`;
      } else {
        css += `--quiz-primary-color: #3498db;`;
      }
      
      if (styling.backgroundColor) {
        css += `--quiz-background-color: ${styling.backgroundColor};`;
      } else {
        css += `--quiz-background-color: #f5f5f5;`;
      }
      
      if (styling.textColor) {
        css += `--quiz-text-color: ${styling.textColor};`;
      } else {
        css += `--quiz-text-color: #333333;`;
      }
      
      // Apply fonts
      if (styling.fontFamily) {
        css += `--quiz-font-family: ${styling.fontFamily};`;
      } else {
        css += `--quiz-font-family: 'Arial', sans-serif;`;
      }
      
      // Apply spacing
      if (styling.spacing) {
        css += `--quiz-spacing: ${styling.spacing};`;
      } else {
        css += `--quiz-spacing: 16px;`;
      }
      
      // Close CSS rule
      css += `}`;
      
      // Add CSS rules to style element
      styleElement.textContent = css;
      
      // Add style element to head
      document.head.appendChild(styleElement);
    }
  
    /**
     * Render the current question
     */
    function renderQuestion() {
      const questionBody = container.querySelector('.quiz-body');
      const question = quizData.questions[currentQuestionIndex];
      const response = responses[currentQuestionIndex];
      
      if (!question || !questionBody) {
        return;
      }
      
      // Update progress indicator
      const progressSpan = container.querySelector('.quiz-progress');
      if (progressSpan) {
        progressSpan.textContent = `${currentQuestionIndex + 1} of ${quizData.questions.length}`;
      }
      
      // Create question container
      const questionContainer = document.createElement('div');
      questionContainer.className = 'quiz-question';
      questionContainer.setAttribute('data-question-id', question.question_id);
      
      // Add question text
      const questionText = document.createElement('h2');
      questionText.className = 'quiz-question-text';
      questionText.innerHTML = question.text;
      questionContainer.appendChild(questionText);
      
      // Render appropriate question type
      switch (question.type) {
        case 'multiple_choice':
          renderMultipleChoice(questionContainer, question, response);
          break;
        case 'user_input':
          renderUserInput(questionContainer, question, response);
          break;
        default:
          console.error(`Unknown question type: ${question.type}`);
          const errorMsg = document.createElement('p');
          errorMsg.className = 'quiz-error-message';
          errorMsg.textContent = 'Unsupported question type.';
          questionContainer.appendChild(errorMsg);
      }
      
      // Clear and append to question body
      questionBody.innerHTML = '';
      questionBody.appendChild(questionContainer);
      
      // Update navigation button states
      updateNavigationState();
    }
  
    /**
     * Render a multiple choice question
     * @param {HTMLElement} container - Question container element
     * @param {Object} question - Question data
     * @param {Object} response - Current response for this question
     */
    function renderMultipleChoice(container, question, response) {
      if (!question.question_answers || !Array.isArray(question.question_answers)) {
        console.error('Multiple choice question has no answers:', question);
        return;
      }
      
      const answerList = document.createElement('div');
      answerList.className = 'quiz-answer-list';
      answerList.setAttribute('role', 'radiogroup');
      answerList.setAttribute('aria-labelledby', `question-${question.question_id}`);
      
      // Create each answer option
      question.question_answers.forEach((answer, index) => {
        const answerItem = document.createElement('div');
        answerItem.className = 'quiz-answer-item';
        
        const radioInput = document.createElement('input');
        radioInput.type = 'radio';
        radioInput.name = `question-${question.question_id}`;
        radioInput.id = `answer-${answer.answer_id}`;
        radioInput.value = answer.answer_id;
        radioInput.className = 'quiz-answer-input';
        radioInput.setAttribute('aria-label', answer.answer);
        
        // Check if this answer is selected
        if (response && response.answer_id === answer.answer_id) {
          radioInput.checked = true;
        }
        
        // Add change event listener
        radioInput.addEventListener('change', () => {
          responses[currentQuestionIndex].answer_id = answer.answer_id;
          responses[currentQuestionIndex].user_input = null;
          updateNavigationState();
        });
        
        const label = document.createElement('label');
        label.htmlFor = `answer-${answer.answer_id}`;
        label.className = 'quiz-answer-label';
        
        // Add answer image if present
        if (answer.image) {
          const img = document.createElement('img');
          img.src = answer.image;
          img.alt = answer.answer;
          img.className = 'quiz-answer-image';
          label.appendChild(img);
        }
        
        // Add answer text
        const answerText = document.createElement('span');
        answerText.className = 'quiz-answer-text';
        answerText.textContent = answer.answer;
        label.appendChild(answerText);
        
        // Append elements to container
        answerItem.appendChild(radioInput);
        answerItem.appendChild(label);
        answerList.appendChild(answerItem);
      });
      
      container.appendChild(answerList);
    }
  
    /**
     * Render a user input question
     * @param {HTMLElement} container - Question container element
     * @param {Object} question - Question data
     * @param {Object} response - Current response for this question
     */
    function renderUserInput(container, question, response) {
      const inputContainer = document.createElement('div');
      inputContainer.className = 'quiz-input-container';
      
      let inputElement;
      
      // Determine if we need a textarea or input based on expected answer length
      // This is somewhat arbitrary - could be configurable
      const useTextarea = question.text.length > 100;
      
      if (useTextarea) {
        inputElement = document.createElement('textarea');
        inputElement.rows = 5;
      } else {
        inputElement = document.createElement('input');
        inputElement.type = 'text';
      }
      
      // Set common properties
      inputElement.className = 'quiz-user-input';
      inputElement.id = `input-${question.question_id}`;
      inputElement.setAttribute('aria-labelledby', `question-${question.question_id}`);
      
      // Set current value if exists
      if (response && response.user_input) {
        inputElement.value = response.user_input;
      }
      
      // Add input event listener
      inputElement.addEventListener('input', (event) => {
        responses[currentQuestionIndex].user_input = event.target.value;
        responses[currentQuestionIndex].answer_id = null;
        updateNavigationState();
      });
      
      inputContainer.appendChild(inputElement);
      container.appendChild(inputContainer);
    }
  
    /**
     * Set up navigation event listeners
     */
    function setupNavigation() {
      const prevButton = container.querySelector('.quiz-prev-button');
      const nextButton = container.querySelector('.quiz-next-button');
      
      if (prevButton) {
        prevButton.addEventListener('click', navigatePrevious);
      }
      
      if (nextButton) {
        nextButton.addEventListener('click', navigateNext);
      }
      
      // Initial button state update
      updateNavigationState();
      
      // Add keyboard navigation support
      container.addEventListener('keydown', (event) => {
        // Allow navigation with arrow keys when not in input fields
        const tagName = event.target.tagName.toLowerCase();
        const isInputField = tagName === 'input' || tagName === 'textarea';
        
        if (!isInputField) {
          if (event.key === 'ArrowLeft') {
            navigatePrevious();
            event.preventDefault();
          } else if (event.key === 'ArrowRight' && canNavigateNext()) {
            navigateNext();
            event.preventDefault();
          }
        }
      });
    }
  
    /**
     * Update navigation button states
     */
    function updateNavigationState() {
      const prevButton = container.querySelector('.quiz-prev-button');
      const nextButton = container.querySelector('.quiz-next-button');
      
      if (prevButton) {
        // Disable previous on first question
        prevButton.disabled = currentQuestionIndex === 0;
      }
      
      if (nextButton) {
        const isLastQuestion = currentQuestionIndex === quizData.questions.length - 1;
        
        // Update button text for last question
        nextButton.textContent = isLastQuestion ? 'Submit' : 'Next';
        
        // Disable next if no answer provided
        nextButton.disabled = !hasValidResponse();
      }
    }
  
    /**
     * Check if current question has a valid response
     * @returns {boolean} Whether response is valid
     */
    function hasValidResponse() {
      const response = responses[currentQuestionIndex];
      const question = quizData.questions[currentQuestionIndex];
      
      if (!response || !question) {
        return false;
      }
      
      // For multiple choice, an answer must be selected
      if (question.type === 'multiple_choice') {
        return !!response.answer_id;
      }
      
      // For user input, there must be text
      if (question.type === 'user_input') {
        return !!response.user_input && response.user_input.trim() !== '';
      }
      
      return false;
    }
  
    /**
     * Check if can navigate to next question
     * @returns {boolean} Whether navigation is possible
     */
    function canNavigateNext() {
      return hasValidResponse();
    }
  
    /**
     * Navigate to previous question
     */
    function navigatePrevious() {
      if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        renderQuestion();
      }
    }
  
    /**
     * Navigate to next question or submit quiz
     */
    function navigateNext() {
      if (!canNavigateNext()) {
        return;
      }
      
      const isLastQuestion = currentQuestionIndex === quizData.questions.length - 1;
      
      if (isLastQuestion) {
        submitQuiz();
      } else {
        currentQuestionIndex++;
        renderQuestion();
      }
    }
  
    /**
     * Submit quiz responses
     */
    function submitQuiz() {
      // Call onComplete callback if provided
      if (typeof config.onComplete === 'function') {
        config.onComplete(responses);
      }
      
      // Submit to server if URL is configured
      if (config.submitUrl) {
        const submitData = {
          quiz_id: config.quizId,
          responses: responses
        };
        
        fetch(config.submitUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(submitData)
        })
          .then(response => {
            if (!response.ok) {
              throw new Error(`HTTP error: ${response.status}`);
            }
            return response.json();
          })
          .then(data => {
            console.log('Quiz submitted successfully:', data);
            renderCompletion();
          })
          .catch(error => {
            console.error('Failed to submit quiz:', error);
            renderError('Failed to submit quiz. Please try again.');
          });
      } else {
        // Just show completion if no submit URL
        renderCompletion();
      }
    }
  
    /**
     * Render quiz completion message
     */
    function renderCompletion() {
      container.innerHTML = `
        <div class="quiz-completion" aria-live="polite">
          <h2>Thank you!</h2>
          <p>Your quiz has been submitted successfully.</p>
          <button class="quiz-restart-button" aria-label="Take another quiz">
            Start Over
          </button>
        </div>
      `;
      
      // Add event listener for restart button
      const restartButton = container.querySelector('.quiz-restart-button');
      if (restartButton) {
        restartButton.addEventListener('click', resetQuiz);
      }
    }
  
    /**
     * Reset quiz to initial state
     */
    function resetQuiz() {
      currentQuestionIndex = 0;
      responses = [];
      renderLoading();
      fetchQuizData()
        .then(data => {
          quizData = sanitizeQuizData(data);
          renderQuiz();
        })
        .catch(error => {
          console.error('Failed to fetch quiz data:', error);
          renderError('Failed to load quiz. Please try again.');
        });
    }
  
    // Return public API
    return {
      init: init
    };
  })();
  
  // Default CSS for quiz styling
  (function() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .quiz-renderer-container {
        --quiz-primary-color: #3498db;
        --quiz-background-color: #f5f5f5;
        --quiz-text-color: #333333;
        --quiz-font-family: 'Arial', sans-serif;
        --quiz-spacing: 16px;
        
        font-family: var(--quiz-font-family);
        color: var(--quiz-text-color);
        background-color: var(--quiz-background-color);
        padding: var(--quiz-spacing);
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        max-width: 800px;
        margin: 0 auto;
      }
      
      .quiz-loading,
      .quiz-error,
      .quiz-completion {
        text-align: center;
        padding: calc(var(--quiz-spacing) * 3);
      }
      
      .quiz-spinner {
        width: 40px;
        height: 40px;
        border: 4px solid rgba(0, 0, 0, 0.1);
        border-left-color: var(--quiz-primary-color);
        border-radius: 50%;
        animation: quiz-spin 1s linear infinite;
        margin: 0 auto 20px;
      }
      
      @keyframes quiz-spin {
        to { transform: rotate(360deg); }
      }
      
      .quiz-header {
        margin-bottom: calc(var(--quiz-spacing) * 2);
      }
      
      .quiz-header h1 {
        margin: 0;
        font-size: 1.8rem;
        color: var(--quiz-primary-color);
      }
      
      .quiz-body {
        min-height: 200px;
        margin-bottom: var(--quiz-spacing);
      }
      
      .quiz-question {
        margin-bottom: calc(var(--quiz-spacing) * 2);
      }
      
      .quiz-question-text {
        margin-top: 0;
        margin-bottom: calc(var(--quiz-spacing) * 1.5);
      }
      
      .quiz-answer-list {
        display: flex;
        flex-direction: column;
        gap: calc(var(--quiz-spacing) * 0.75);
      }
      
      .quiz-answer-item {
        display: flex;
        align-items: center;
        padding: calc(var(--quiz-spacing) * 0.75);
        border: 1px solid #ddd;
        border-radius: 4px;
        transition: background-color 0.2s;
      }
      
      .quiz-answer-item:hover {
        background-color: rgba(0, 0, 0, 0.03);
      }
      
      .quiz-answer-input {
        margin-right: calc(var(--quiz-spacing) * 0.75);
      }
      
      .quiz-answer-label {
        display: flex;
        align-items: center;
        cursor: pointer;
        flex: 1;
      }
      
      .quiz-answer-image {
        max-width: 100px;
        max-height: 100px;
        margin-right: var(--quiz-spacing);
        border-radius: 4px;
      }
      
      .quiz-input-container {
        margin-top: var(--quiz-spacing);
      }
      
      .quiz-user-input {
        width: 100%;
        padding: calc(var(--quiz-spacing) * 0.75);
        border: 1px solid #ddd;
        border-radius: 4px;
        font-family: inherit;
        font-size: 1rem;
      }
      
      .quiz-footer {
        margin-top: calc(var(--quiz-spacing) * 2);
        border-top: 1px solid #ddd;
        padding-top: var(--quiz-spacing);
      }
      
      .quiz-navigation {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .quiz-prev-button,
      .quiz-next-button,
      .quiz-retry-button,
      .quiz-restart-button {
        padding: calc(var(--quiz-spacing) * 0.5) var(--quiz-spacing);
        background-color: var(--quiz-primary-color);
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        transition: background-color 0.2s;
      }
      
      .quiz-prev-button:disabled,
      .quiz-next-button:disabled {
        background-color: #ccc;
        cursor: not-allowed;
      }
      
      .quiz-retry-button,
      .quiz-restart-button {
        display: inline-block;
        margin-top: var(--quiz-spacing);
      }
      
      .quiz-prev-button:hover:not(:disabled),
      .quiz-next-button:hover:not(:disabled),
      .quiz-retry-button:hover,
      .quiz-restart-button:hover {
        background-color: #2980b9;
      }
      
      .quiz-progress {
        color: #777;
      }
      
      .quiz-error-message {
        color: #e74c3c;
        font-style: italic;
      }
    `;
    
    document.head.appendChild(styleElement);
  })();
  
  // Export as a module
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = QuizRenderer;
  } else {
    window.QuizRenderer = QuizRenderer;
  }