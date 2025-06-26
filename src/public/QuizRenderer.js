/**
 * QuizRenderer.js - A client library for rendering interactive quizzes
 * Luis Mata (c) 2023
 * 
 * @module QuizRenderer
 * @version 1.0.0
 */

const QuizRenderer = (function () {
  // Private variables
  let container = null;
  let quizData = null;
  let currentQuestionIndex = 0;
  let responses = [];
  let config = {
      quizId: null,
      onComplete: null,
      submitUrl: null,
      apiUrl: null,
      themeClass: null,
      userName: null,
      userEmail: null,
      model: 'quiz_model_1',
      segment: 'general'
  };

  /**
   * Initialize the quiz renderer
   * @param {string} containerId - ID of container element
   * @param {Object} options - Configuration options
   * @param {string} options.quizId - ID of quiz to fetch
   * @param {Function} [options.onComplete] - Callback on quiz completion
   * @param {string} [options.themeClass] - CSS class for theming
   * @param {string} [options.submitUrl] - URL for quiz submission
   * @param {string} [options.userName] - User's name
   * @param {string} [options.userEmail] - User's email
   * @param {string} [options.model] - Quiz model identifier
   * @param {string} [options.segment] - Quiz segment
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
          const response = await fetch(`${config.apiUrl}/api/quizmanager_quizzes/${encodeURIComponent(config.quizId)}`);
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
        <div class="quiz-body" aria-live="polite">
          <!-- Question will be rendered here -->
        </div>
        <footer class="quiz-footer">
          <div class="quiz-navigation">
            <button class="quiz-prev-button" aria-label="Previous question">Previous</button>
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
      const hasImages = question.question_answers.some(answer => answer.image);
      const imageCount = question.question_answers.filter(answer => answer.image).length;

      if (hasImages) {
          if (imageCount <= 3) {
              answerList.classList.add('has-images');
          } else {
              answerList.classList.add('has-many-images');
              // Create custom dropdown for many images
              const dropdownContainer = document.createElement('div');
              dropdownContainer.className = 'quiz-custom-dropdown';

              const dropdownButton = document.createElement('button');
              dropdownButton.className = 'quiz-dropdown-button';
              dropdownButton.setAttribute('aria-expanded', 'false');
              dropdownButton.setAttribute('aria-haspopup', 'listbox');

              const buttonContent = document.createElement('div');
              buttonContent.className = 'quiz-dropdown-button-content';
              dropdownButton.appendChild(buttonContent);

              const buttonText = document.createElement('span');
              buttonText.className = 'quiz-dropdown-button-text';
              buttonText.textContent = 'Select an answer';
              buttonContent.appendChild(buttonText);

              const dropdownList = document.createElement('ul');
              dropdownList.className = 'quiz-dropdown-list';
              dropdownList.setAttribute('role', 'listbox');
              dropdownList.setAttribute('aria-label', 'Select an answer');

              // Add options for each answer
              question.question_answers.forEach(answer => {
                  const listItem = document.createElement('li');
                  listItem.className = 'quiz-dropdown-item';
                  listItem.setAttribute('role', 'option');
                  listItem.setAttribute('data-value', answer.answer_id);

                  if (response && response.answer_id === answer.answer_id) {
                      listItem.classList.add('selected');
                      buttonContent.innerHTML = '';
                      if (answer.image) {
                          const buttonImg = document.createElement('img');
                          buttonImg.src = answer.image;
                          buttonImg.alt = '';
                          buttonImg.className = 'quiz-dropdown-button-image';
                          buttonContent.appendChild(buttonImg);
                      }
                      buttonText.textContent = answer.answer;
                      buttonContent.appendChild(buttonText);
                  }

                  if (answer.image) {
                      const img = document.createElement('img');
                      img.src = answer.image;
                      img.alt = '';
                      img.className = 'quiz-dropdown-image';
                      listItem.appendChild(img);
                  }

                  const text = document.createElement('span');
                  text.textContent = answer.answer;
                  listItem.appendChild(text);

                  listItem.addEventListener('click', () => {
                      // Update button content
                      buttonContent.innerHTML = '';
                      if (answer.image) {
                          const buttonImg = document.createElement('img');
                          buttonImg.src = answer.image;
                          buttonImg.alt = '';
                          buttonImg.className = 'quiz-dropdown-button-image';
                          buttonContent.appendChild(buttonImg);
                      }
                      buttonText.textContent = answer.answer;
                      buttonContent.appendChild(buttonText);

                      // Update selected state
                      dropdownList.querySelectorAll('.quiz-dropdown-item').forEach(item => {
                          item.classList.remove('selected');
                      });
                      listItem.classList.add('selected');

                      // Update response
                      responses[currentQuestionIndex].answer_id = answer.answer_id;
                      responses[currentQuestionIndex].user_input = null;
                      updateNavigationState();

                      // Close dropdown
                      dropdownList.classList.remove('show');
                      dropdownButton.setAttribute('aria-expanded', 'false');
                  });

                  dropdownList.appendChild(listItem);
              });

              // Toggle dropdown on button click
              dropdownButton.addEventListener('click', () => {
                  const isExpanded = dropdownButton.getAttribute('aria-expanded') === 'true';
                  dropdownButton.setAttribute('aria-expanded', !isExpanded);
                  dropdownList.classList.toggle('show');
              });

              // Close dropdown when clicking outside
              document.addEventListener('click', (event) => {
                  if (!dropdownContainer.contains(event.target)) {
                      dropdownList.classList.remove('show');
                      dropdownButton.setAttribute('aria-expanded', 'false');
                  }
              });

              dropdownContainer.appendChild(dropdownButton);
              dropdownContainer.appendChild(dropdownList);
              container.appendChild(dropdownContainer);
              return;
          }
      }

      answerList.setAttribute('role', 'radiogroup');
      answerList.setAttribute('aria-labelledby', `question-${question.question_id}`);

      // Create each answer option
      question.question_answers.forEach((answer, index) => {
          const answerItem = document.createElement('div');
          answerItem.className = 'quiz-answer-item';
          if (response && response.answer_id === answer.answer_id) {
              answerItem.classList.add('selected');
          }

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

          // Add click handler to the entire answer item
          answerItem.addEventListener('click', () => {
              // Remove selected class from all items
              document.querySelectorAll('.quiz-answer-item').forEach(item => {
                  item.classList.remove('selected');
              });

              // Add selected class to clicked item
              answerItem.classList.add('selected');

              // Update the radio input
              radioInput.checked = true;

              // Update responses
              responses[currentQuestionIndex].answer_id = answer.answer_id;
              responses[currentQuestionIndex].user_input = null;
              updateNavigationState();
          });

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

      const emailQuestion = quizData.questions.find(question =>
          question.text.toLowerCase().includes("what's your email") &&
          question.type === "user_input"
      );

      const firstName = quizData.questions.find(question =>
          question.text.toLowerCase().includes("please type in your first name below") &&
          question.type === "user_input"
      );

      const lastName = quizData.questions.find(question =>
          question.text.toLowerCase().includes("please type in your last name below") &&
          question.type === "user_input"
      );

      const agreement = quizData.questions.find(question =>
          question.text.toLowerCase().includes("by checking this box, you are providing express written consent") &&
          question.type === "multiple_choice"
      );

      const conditions = quizData.questions.find(question =>
          question.text.toLowerCase().includes("please share if you have any of the following conditions") &&
          question.type === "multiple_choice"
      );

      if (emailQuestion) {
          const emailResponse = responses.find(response =>
              response.question_id === emailQuestion.question_id
          );
          if (emailResponse && emailResponse.user_input) {
              config.userEmail = emailResponse.user_input;
          }
      }
      if (firstName && lastName) {
          const firstNameResponse = responses.find(response =>
              response.question_id === firstName.question_id
          );

          const lastNameResponse = responses.find(response =>
              response.question_id === lastName.question_id
          );

          if (firstNameResponse && firstNameResponse.user_input && lastNameResponse && lastNameResponse.user_input) {
              config.userName = firstNameResponse.user_input + " " + lastNameResponse.user_input;
          }
      }

      if (agreement) {
          const agreementResponse = responses.find(response =>
              response.question_id === agreement.question_id
          );

          // Find the "Yes" answer in the agreement question
          const yesAnswer = agreement.question_answers.find(answer =>
              answer.answer.toLowerCase().includes("yes, i acknowledge")
          );

          // Check if user selected the "Yes" answer
          if (!agreementResponse || !yesAnswer || agreementResponse.answer_id !== yesAnswer.answer_id) {
              renderError('You must agree to the terms and conditions to continue.');
              return;
          }
      }

      if (conditions) {
          const conditionsResponse = responses.find(response =>
              response.question_id === conditions.question_id
          );

          // Find the "None of the Above" answer
          const noneOfTheAbove = conditions.question_answers.find(answer =>
              answer.answer.toLowerCase().includes("none of the above")
          );

          // Check if user selected anything other than "None of the Above"
          if (!conditionsResponse || !noneOfTheAbove || conditionsResponse.answer_id !== noneOfTheAbove.answer_id) {
              renderError('We apologize, but we are not qualified to help with your specific health conditions at this time.');
              return;
          }
      }

      // Submit to server if URL is configured
      if (`${config.submitUrl}/api/quizmanager_results`) {
          const submitData = {
              Name: config.userName || 'Anonymous',
              email: config.userEmail || '',
              answers: {
                  quiz_id: parseInt(config.quizId),
                  responses: responses
              },
              model: config.model || 'quiz_model_1',
              segment: config.segment || 'general',
              Source: 'web_quiz'
          };

          fetch(`${config.submitUrl}/api/quizmanager_results`, {
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

                  // Call onComplete callback if provided
                  if (typeof config.onComplete === 'function') {
                      config.onComplete(responses);
                  }
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
        border-radius: 8px 8px 0 0;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        max-width: 800px;
        margin: 0 auto;
      position: relative;
      overflow: hidden;
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
        overflow: visible;
      }
      
      .quiz-question {
        margin-bottom: calc(var(--quiz-spacing) * 2);
        text-align: center;
      }
      
      .quiz-question-text {
        margin-top: 30px;
        margin-left: 10px;
        margin-right: 10px;
        margin-bottom: calc(var(--quiz-spacing) * 2);
        font-size: 1.5rem;
        font-weight: 400;
        color: #2c3e50;
        line-height: 1.4;
      }
      
      .quiz-answer-list {
        display: flex;
        flex-direction: column;
        gap: calc(var(--quiz-spacing) * 0.75);
        text-align: left;
      }
      
      .quiz-answer-item {
        display: flex;
        align-items: center;
        margin-left: 30px;
        margin-right: 30px;
        padding: calc(var(--quiz-spacing) * 1);
        border: 2px solid #ddd;
        border-radius: 8px;
        transition: all 0.2s ease;
        background-color: white;
        cursor: pointer;
        position: relative;
      }
      
      .quiz-answer-item:hover {
        border-color: var(--quiz-primary-color);
        background-color: rgba(52, 152, 219, 0.05);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
      }
      
      .quiz-answer-input {
        position: absolute;
        top: 10px;
        left: 10px;
        width: 24px;
        height: 24px;
        border: 2px solid #ddd;
        border-radius: 50%;
        appearance: none;
        -webkit-appearance: none;
        cursor: pointer;
        transition: all 0.2s ease;
        pointer-events: none;
        margin: 0;
      }
      
      .quiz-answer-item.selected {
        border-color: var(--quiz-primary-color);
        background-color: rgba(52, 152, 219, 0.05);
      }
      
      .quiz-answer-item.selected .quiz-answer-input {
        border-color: var(--quiz-primary-color);
        background-color: var(--quiz-primary-color);
      }
      
      .quiz-answer-item.selected .quiz-answer-input::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 12px;
        height: 12px;
        background-color: white;
        border-radius: 50%;
      }
      
      .quiz-answer-label {
        display: flex;
        align-items: center;
        cursor: pointer;
        flex: 1;
        font-size: 1.1rem;
        font-weight: 500;
        margin-left: 40px;
      }
      
      .quiz-answer-image {
        max-width: 120px;
        max-height: 120px;
        margin-right: var(--quiz-spacing);
        border-radius: 8px;
        object-fit: cover;
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
        margin: 0;
        padding: 0;
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
      }
      
      .quiz-navigation {
        display: flex;
        justify-content: space-between;
        align-items: stretch;
        width: 100%;
        gap: 0;
      }
      
      .quiz-prev-button,
      .quiz-next-button,
      .quiz-retry-button,
      .quiz-restart-button {
        flex: 1;
        padding: calc(var(--quiz-spacing) * 0.75) var(--quiz-spacing);
        background-color: var(--quiz-primary-color);
        color: white;
        border: none;
        border-radius: 0;
        cursor: pointer;
        font-weight: bold;
        transition: all 0.2s ease;
        text-transform: uppercase;
        font-size: 1rem;
        letter-spacing: 0.5px;
        text-align: center;
        min-height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .quiz-prev-button:disabled,
      .quiz-next-button:disabled {
        background-color: #ccc;
        cursor: not-allowed;
        opacity: 0.7;
      }
      
      .quiz-retry-button,
      .quiz-restart-button {
        display: inline-block;
        margin-top: var(--quiz-spacing);
        width: auto;
        min-width: 200px;
      }
      
      .quiz-prev-button:hover:not(:disabled),
      .quiz-next-button:hover:not(:disabled),
      .quiz-retry-button:hover,
      .quiz-restart-button:hover {
        background-color: #2980b9;
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      }
      
      .quiz-error-message {
        color: #e74c3c;
        font-style: italic;
      }

    .quiz-content {
      position: relative;
      padding-bottom: 60px;
      overflow: visible;
    }

    .quiz-next-button {
      border-left: 1px solid rgba(255, 255, 255, 0.3);
    }

    .quiz-answer-list.has-images {
      flex-direction: row;
      justify-content: center;
    }
    
    .quiz-answer-list.has-images .quiz-answer-item {
      flex: 0 1 calc(50% - var(--quiz-spacing));
      margin-left: 15px;
      margin-right: 15px;
      min-width: 220px;
      flex-direction: column;
      text-align: center;
    }

    .quiz-answer-list.has-images .quiz-answer-label {
      flex-direction: column;
      margin-left: 0;
    }

    .quiz-answer-list.has-images .quiz-answer-image {
      margin-right: 0;
      margin-bottom: var(--quiz-spacing);
      width: 100%;
      height: 200px;
      object-fit: cover;
    }

    .quiz-answer-list.has-many-images {
      flex-direction: column;
    }
    
    .quiz-answer-list.has-many-images .quiz-answer-item {
      flex: 1;
      margin-left: 30px;
      margin-right: 30px;
      flex-direction: row;
      text-align: left;
    }

    .quiz-answer-list.has-many-images .quiz-answer-label {
      flex-direction: row;
      margin-left: 40px;
    }

    .quiz-answer-list.has-many-images .quiz-answer-image {
      margin-right: var(--quiz-spacing);
      margin-bottom: 0;
      width: 30px;
      height: 30px;
      object-fit: cover;
    }

    .quiz-custom-dropdown {
      position: relative;
      width: calc(100% - 60px);
      margin: 0 30px;
      z-index: 1000;
    }

    .quiz-dropdown-button {
      width: 100%;
      padding: calc(var(--quiz-spacing) * 0.75);
      border: 2px solid #ddd;
      border-radius: 8px;
      background-color: white;
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      font-size: 1.1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .quiz-dropdown-button-content {
      display: flex;
      align-items: center;
      gap: var(--quiz-spacing);
      flex: 1;
    }

    .quiz-dropdown-button-image {
      width: 24px;
      height: 24px;
      object-fit: cover;
      border-radius: 4px;
    }

    .quiz-dropdown-button::after {
      content: '';
      width: 20px;
      height: 20px;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: center;
      background-size: contain;
    }

    .quiz-dropdown-list {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background-color: white;
      border: 2px solid #ddd;
      border-radius: 8px;
      margin-top: 4px;
      padding: 0;
      list-style: none;
      max-height: 150px;
      overflow-y: auto;
      display: none;
      z-index: 1001;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      scrollbar-width: thin;
      scrollbar-color: var(--quiz-primary-color) #f0f0f0;
    }

    .quiz-dropdown-list::-webkit-scrollbar {
      width: 8px;
    }

    .quiz-dropdown-list::-webkit-scrollbar-track {
      background: #f0f0f0;
      border-radius: 4px;
    }

    .quiz-dropdown-list::-webkit-scrollbar-thumb {
      background-color: var(--quiz-primary-color);
      border-radius: 4px;
      border: 2px solid #f0f0f0;
    }

    .quiz-dropdown-list.show {
      display: block;
    }

    .quiz-dropdown-item {
      padding: calc(var(--quiz-spacing) * 0.75);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: var(--quiz-spacing);
    }

    .quiz-dropdown-item:hover {
      background-color: rgba(52, 152, 219, 0.05);
    }

    .quiz-dropdown-item.selected {
      background-color: rgba(52, 152, 219, 0.1);
    }

    .quiz-dropdown-image {
      width: 30px;
      height: 30px;
      object-fit: cover;
      border-radius: 4px;
    }

    .quiz-dropdown-button:focus,
    .quiz-dropdown-item:focus {
      outline: none;
      border-color: var(--quiz-primary-color);
      box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
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